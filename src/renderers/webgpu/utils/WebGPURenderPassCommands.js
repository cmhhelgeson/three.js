/**
 * The set of commands that can be recorded onto a `GPURenderPassEncoder`.
 *
 * Each entry is an opcode written into {@link WebGPURenderPassCommands#commands}
 * ahead of that command's arguments.
 *
 * @private
 * @type {Object<string, number>}
 */
const RenderPassCommand = {
	SET_PIPELINE: 0,
	SET_BIND_GROUP: 1,
	SET_INDEX_BUFFER: 2,
	SET_VERTEX_BUFFER: 3,
	SET_VIEWPORT: 4,
	SET_SCISSOR_RECT: 5,
	SET_STENCIL_REFERENCE: 6,
	SET_BLEND_CONSTANT: 7,
	DRAW: 8,
	DRAW_INDEXED: 9,
	DRAW_INDIRECT: 10,
	DRAW_INDEXED_INDIRECT: 11,
	EXECUTE_BUNDLES: 12,
	BEGIN_OCCLUSION_QUERY: 13,
	END_OCCLUSION_QUERY: 14,
	PUSH_DEBUG_GROUP: 15,
	POP_DEBUG_GROUP: 16,
	INSERT_DEBUG_MARKER: 17
};

/**
 * How many integers follow each opcode in the command stream. Replay uses this
 * to step from one command to the next without allocating per command objects.
 *
 * @private
 * @type {Object<number, number>}
 */
const COMMAND_LENGTHS = {
	[ RenderPassCommand.SET_PIPELINE ]: 1,
	[ RenderPassCommand.SET_BIND_GROUP ]: 3,
	[ RenderPassCommand.SET_INDEX_BUFFER ]: 4,
	[ RenderPassCommand.SET_VERTEX_BUFFER ]: 4,
	[ RenderPassCommand.SET_VIEWPORT ]: 1,
	[ RenderPassCommand.SET_SCISSOR_RECT ]: 4,
	[ RenderPassCommand.SET_STENCIL_REFERENCE ]: 1,
	[ RenderPassCommand.SET_BLEND_CONSTANT ]: 1,
	[ RenderPassCommand.DRAW ]: 4,
	[ RenderPassCommand.DRAW_INDEXED ]: 5,
	[ RenderPassCommand.DRAW_INDIRECT ]: 2,
	[ RenderPassCommand.DRAW_INDEXED_INDIRECT ]: 2,
	[ RenderPassCommand.EXECUTE_BUNDLES ]: 1,
	[ RenderPassCommand.BEGIN_OCCLUSION_QUERY ]: 1,
	[ RenderPassCommand.END_OCCLUSION_QUERY ]: 0,
	[ RenderPassCommand.PUSH_DEBUG_GROUP ]: 1,
	[ RenderPassCommand.POP_DEBUG_GROUP ]: 0,
	[ RenderPassCommand.INSERT_DEBUG_MARKER ]: 1
};

/**
 * Written in place of an argument the caller left undefined, so that every
 * command keeps a fixed width in the command stream.
 *
 * @private
 * @type {number}
 */
const UNDEFINED = - 1;

/**
 * The initial capacity of the command stream, in integers.
 *
 * @private
 * @type {number}
 */
const INITIAL_CAPACITY = 1024;

/**
 * A recording of the commands destined for a single `GPURenderPassEncoder`.
 *
 * The renderer records into one of these instead of talking to a live pass
 * encoder, then replays the recording later against a real encoder. That
 * decoupling is what lets a frame open its render passes one at a time, in
 * order, on a single `GPUCommandEncoder`, rather than needing a fresh command
 * encoder every time a pass is opened while another is still in flight.
 *
 * Commands are stored in an `Int32Array`: an opcode from
 * {@link RenderPassCommand} followed by a fixed number of integers. Integer
 * arguments are stored inline. Everything else, a `GPURenderPipeline`, a
 * `GPUBindGroup`, a `GPUBuffer`, an array of render bundles, a debug label, or
 * a payload with fractional components such as a viewport or a blend constant,
 * lives in the {@link WebGPURenderPassCommands#resources} table and is stored
 * as its index into that table. Object resources are interned, so binding the
 * same pipeline a thousand times costs one table entry and a thousand integers.
 *
 * Beginning and ending the pass are deliberately not recordable. The caller
 * owns the pass lifetime: it calls `beginRenderPass()` with the descriptor it
 * has, replays the recording with {@link WebGPURenderPassCommands#execute} and
 * then calls `end()`.
 *
 * ```js
 * const commands = new WebGPURenderPassCommands();
 * commands.setPipeline( pipelineGPU );
 * commands.setBindGroup( 0, bindGroupGPU );
 * commands.draw( 3, 1, 0, 0 );
 *
 * // later, on a single command encoder for the whole frame
 * const passEncoderGPU = commandEncoderGPU.beginRenderPass( descriptor );
 * commands.execute( passEncoderGPU );
 * passEncoderGPU.end();
 * ```
 *
 * @private
 */
class WebGPURenderPassCommands {

	/**
	 * Constructs a new, empty render pass recording.
	 */
	constructor() {

		/**
		 * The command stream: opcodes interleaved with their integer arguments.
		 *
		 * Only the first {@link WebGPURenderPassCommands#length} entries are live.
		 * The buffer is grown on demand and kept across {@link WebGPURenderPassCommands#reset}
		 * so a pooled recording stops reallocating after the first few frames.
		 *
		 * Buffer offsets and sizes are written as signed 32 bit integers, which
		 * caps them at 2 GiB. WebGPU's `maxBufferSize` is far below that on every
		 * current implementation.
		 *
		 * @type {Int32Array}
		 */
		this.commands = new Int32Array( INITIAL_CAPACITY );

		/**
		 * The number of live integers in {@link WebGPURenderPassCommands#commands},
		 * which doubles as the write cursor.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.length = 0;

		/**
		 * The non integer arguments referenced by the command stream. Pipelines,
		 * bind groups, buffers, bundle arrays, debug labels, viewports and blend
		 * constants all live here and are addressed by index.
		 *
		 * @type {Array<any>}
		 */
		this.resources = [];

		/**
		 * The number of commands recorded so far. This is not
		 * {@link WebGPURenderPassCommands#length}, which also counts arguments.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.count = 0;

		/**
		 * The descriptor the pass should be begun with, for callers that want the
		 * recording to carry everything needed to replay itself. The recorder never
		 * reads this.
		 *
		 * @type {?GPURenderPassDescriptor}
		 * @default null
		 */
		this.descriptor = null;

		/**
		 * Maps an already seen resource to its index in
		 * {@link WebGPURenderPassCommands#resources}.
		 *
		 * @private
		 * @type {Map<any, number>}
		 */
		this._resourceIds = new Map();

	}

	/**
	 * Whether anything has been recorded yet.
	 *
	 * @type {boolean}
	 * @readonly
	 */
	get isEmpty() {

		return this.count === 0;

	}

	/**
	 * Grows the command stream until it can hold the given number of integers.
	 *
	 * @private
	 * @param {number} required - The capacity the stream must reach.
	 */
	_grow( required ) {

		let capacity = this.commands.length;

		while ( capacity < required ) capacity *= 2;

		const commands = new Int32Array( capacity );
		commands.set( this.commands );

		this.commands = commands;

	}

	/**
	 * Makes room for a command of the given width and returns the command stream.
	 *
	 * @private
	 * @param {number} size - The number of integers the command occupies, opcode included.
	 * @return {Int32Array} The command stream, guaranteed to have room.
	 */
	_reserve( size ) {

		if ( this.length + size > this.commands.length ) this._grow( this.length + size );

		return this.commands;

	}

	/**
	 * Interns a resource and returns the index it can be referenced by. Calling
	 * this twice with the same resource returns the same index.
	 *
	 * @private
	 * @param {any} resource - The resource to intern.
	 * @return {number} The index into the resource table, or `-1` when there is no resource.
	 */
	_id( resource ) {

		if ( resource === undefined || resource === null ) return UNDEFINED;

		let id = this._resourceIds.get( resource );

		if ( id === undefined ) {

			id = this.resources.length;

			this.resources.push( resource );
			this._resourceIds.set( resource, id );

		}

		return id;

	}

	/**
	 * Stores a one shot payload in the resource table without interning it, for
	 * values that are copied per call and never repeat.
	 *
	 * @private
	 * @param {any} value - The value to store.
	 * @return {number} The index into the resource table.
	 */
	_value( value ) {

		const id = this.resources.length;

		this.resources.push( value );

		return id;

	}

	// state

	/**
	 * Records `setPipeline()`.
	 *
	 * @param {GPURenderPipeline} pipeline - The pipeline to bind.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setPipeline( pipeline ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_PIPELINE;
		commands[ k ++ ] = this._id( pipeline );

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setBindGroup()`.
	 *
	 * @param {number} index - The bind group slot.
	 * @param {GPUBindGroup} bindGroup - The bind group to bind.
	 * @param {?Array<number>} [dynamicOffsets=null] - Offsets for the group's dynamic buffer bindings.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setBindGroup( index, bindGroup, dynamicOffsets = null ) {

		const commands = this._reserve( 4 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_BIND_GROUP;
		commands[ k ++ ] = index;
		commands[ k ++ ] = this._id( bindGroup );
		commands[ k ++ ] = this._id( dynamicOffsets );

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setIndexBuffer()`.
	 *
	 * @param {GPUBuffer} buffer - The buffer holding the index data.
	 * @param {string} indexFormat - The index format, `'uint16'` or `'uint32'`.
	 * @param {number} [offset=0] - The byte offset into the buffer.
	 * @param {?number} [size=null] - The byte length to bind, or null for the rest of the buffer.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setIndexBuffer( buffer, indexFormat, offset = 0, size = null ) {

		const commands = this._reserve( 5 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_INDEX_BUFFER;
		commands[ k ++ ] = this._id( buffer );
		commands[ k ++ ] = this._id( indexFormat );
		commands[ k ++ ] = offset;
		commands[ k ++ ] = size === null ? UNDEFINED : size;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setVertexBuffer()`.
	 *
	 * @param {number} slot - The vertex buffer slot.
	 * @param {GPUBuffer} buffer - The buffer holding the vertex data.
	 * @param {number} [offset=0] - The byte offset into the buffer.
	 * @param {?number} [size=null] - The byte length to bind, or null for the rest of the buffer.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setVertexBuffer( slot, buffer, offset = 0, size = null ) {

		const commands = this._reserve( 5 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_VERTEX_BUFFER;
		commands[ k ++ ] = slot;
		commands[ k ++ ] = this._id( buffer );
		commands[ k ++ ] = offset;
		commands[ k ++ ] = size === null ? UNDEFINED : size;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setViewport()`. The depth range is fractional, so the arguments are
	 * copied into the resource table rather than the integer command stream.
	 *
	 * @param {number} x - The viewport's x coordinate.
	 * @param {number} y - The viewport's y coordinate.
	 * @param {number} width - The viewport's width.
	 * @param {number} height - The viewport's height.
	 * @param {number} minDepth - The minimum depth value.
	 * @param {number} maxDepth - The maximum depth value.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setViewport( x, y, width, height, minDepth, maxDepth ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_VIEWPORT;
		commands[ k ++ ] = this._value( [ x, y, width, height, minDepth, maxDepth ] );

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setScissorRect()`.
	 *
	 * @param {number} x - The scissor rectangle's x coordinate.
	 * @param {number} y - The scissor rectangle's y coordinate.
	 * @param {number} width - The scissor rectangle's width.
	 * @param {number} height - The scissor rectangle's height.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setScissorRect( x, y, width, height ) {

		const commands = this._reserve( 5 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_SCISSOR_RECT;
		commands[ k ++ ] = x;
		commands[ k ++ ] = y;
		commands[ k ++ ] = width;
		commands[ k ++ ] = height;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setStencilReference()`.
	 *
	 * @param {number} reference - The stencil reference value.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setStencilReference( reference ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_STENCIL_REFERENCE;
		commands[ k ++ ] = reference;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `setBlendConstant()`. The color is copied, so the caller is free to
	 * reuse the object it passed in.
	 *
	 * @param {{r: number, g: number, b: number, a: number}} color - The blend constant.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	setBlendConstant( color ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.SET_BLEND_CONSTANT;
		commands[ k ++ ] = this._value( { r: color.r, g: color.g, b: color.b, a: color.a } );

		this.length = k;
		this.count ++;

		return this;

	}

	// draw

	/**
	 * Records `draw()`.
	 *
	 * @param {number} vertexCount - The number of vertices to draw.
	 * @param {number} [instanceCount=1] - The number of instances to draw.
	 * @param {number} [firstVertex=0] - The first vertex to draw.
	 * @param {number} [firstInstance=0] - The first instance to draw.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	draw( vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0 ) {

		const commands = this._reserve( 5 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.DRAW;
		commands[ k ++ ] = vertexCount;
		commands[ k ++ ] = instanceCount;
		commands[ k ++ ] = firstVertex;
		commands[ k ++ ] = firstInstance;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `drawIndexed()`.
	 *
	 * @param {number} indexCount - The number of indices to draw.
	 * @param {number} [instanceCount=1] - The number of instances to draw.
	 * @param {number} [firstIndex=0] - The first index to draw.
	 * @param {number} [baseVertex=0] - The value added to each index before indexing the vertex buffers.
	 * @param {number} [firstInstance=0] - The first instance to draw.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	drawIndexed( indexCount, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0 ) {

		const commands = this._reserve( 6 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.DRAW_INDEXED;
		commands[ k ++ ] = indexCount;
		commands[ k ++ ] = instanceCount;
		commands[ k ++ ] = firstIndex;
		commands[ k ++ ] = baseVertex;
		commands[ k ++ ] = firstInstance;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `drawIndirect()`.
	 *
	 * @param {GPUBuffer} indirectBuffer - The buffer holding the draw arguments.
	 * @param {number} indirectOffset - The byte offset of the draw arguments.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	drawIndirect( indirectBuffer, indirectOffset ) {

		const commands = this._reserve( 3 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.DRAW_INDIRECT;
		commands[ k ++ ] = this._id( indirectBuffer );
		commands[ k ++ ] = indirectOffset;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `drawIndexedIndirect()`.
	 *
	 * @param {GPUBuffer} indirectBuffer - The buffer holding the draw arguments.
	 * @param {number} indirectOffset - The byte offset of the draw arguments.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	drawIndexedIndirect( indirectBuffer, indirectOffset ) {

		const commands = this._reserve( 3 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.DRAW_INDEXED_INDIRECT;
		commands[ k ++ ] = this._id( indirectBuffer );
		commands[ k ++ ] = indirectOffset;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `executeBundles()`. The array is interned by identity, so it must
	 * not be mutated before the recording is replayed.
	 *
	 * @param {Array<GPURenderBundle>} bundles - The render bundles to execute.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	executeBundles( bundles ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.EXECUTE_BUNDLES;
		commands[ k ++ ] = this._id( bundles );

		this.length = k;
		this.count ++;

		return this;

	}

	// queries

	/**
	 * Records `beginOcclusionQuery()`.
	 *
	 * @param {number} queryIndex - The index into the pass's occlusion query set.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	beginOcclusionQuery( queryIndex ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.BEGIN_OCCLUSION_QUERY;
		commands[ k ++ ] = queryIndex;

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `endOcclusionQuery()`.
	 *
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	endOcclusionQuery() {

		const commands = this._reserve( 1 );

		commands[ this.length ++ ] = RenderPassCommand.END_OCCLUSION_QUERY;
		this.count ++;

		return this;

	}

	// debug

	/**
	 * Records `pushDebugGroup()`.
	 *
	 * @param {string} groupLabel - The label of the debug group.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	pushDebugGroup( groupLabel ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.PUSH_DEBUG_GROUP;
		commands[ k ++ ] = this._id( groupLabel );

		this.length = k;
		this.count ++;

		return this;

	}

	/**
	 * Records `popDebugGroup()`.
	 *
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	popDebugGroup() {

		const commands = this._reserve( 1 );

		commands[ this.length ++ ] = RenderPassCommand.POP_DEBUG_GROUP;
		this.count ++;

		return this;

	}

	/**
	 * Records `insertDebugMarker()`.
	 *
	 * @param {string} markerLabel - The label of the debug marker.
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	insertDebugMarker( markerLabel ) {

		const commands = this._reserve( 2 );
		let k = this.length;

		commands[ k ++ ] = RenderPassCommand.INSERT_DEBUG_MARKER;
		commands[ k ++ ] = this._id( markerLabel );

		this.length = k;
		this.count ++;

		return this;

	}

	// replay

	/**
	 * Replays every recorded command, in order, onto a live render pass encoder.
	 *
	 * The pass must already be open, and the caller is responsible for ending it.
	 * The recording is left intact so it can be replayed again or inspected.
	 *
	 * @param {GPURenderPassEncoder} passEncoderGPU - The encoder to replay onto.
	 */
	execute( passEncoderGPU ) {

		const { commands, resources, length } = this;

		let i = 0;

		while ( i < length ) {

			const command = commands[ i ++ ];

			switch ( command ) {

				case RenderPassCommand.SET_PIPELINE:

					passEncoderGPU.setPipeline( resources[ commands[ i ] ] );
					break;

				case RenderPassCommand.SET_BIND_GROUP: {

					const dynamicOffsetsId = commands[ i + 2 ];

					if ( dynamicOffsetsId === UNDEFINED ) {

						passEncoderGPU.setBindGroup( commands[ i ], resources[ commands[ i + 1 ] ] );

					} else {

						passEncoderGPU.setBindGroup( commands[ i ], resources[ commands[ i + 1 ] ], resources[ dynamicOffsetsId ] );

					}

					break;

				}

				case RenderPassCommand.SET_INDEX_BUFFER: {

					const size = commands[ i + 3 ];

					passEncoderGPU.setIndexBuffer( resources[ commands[ i ] ], resources[ commands[ i + 1 ] ], commands[ i + 2 ], size === UNDEFINED ? undefined : size );
					break;

				}

				case RenderPassCommand.SET_VERTEX_BUFFER: {

					const size = commands[ i + 3 ];

					passEncoderGPU.setVertexBuffer( commands[ i ], resources[ commands[ i + 1 ] ], commands[ i + 2 ], size === UNDEFINED ? undefined : size );
					break;

				}

				case RenderPassCommand.SET_VIEWPORT: {

					const viewport = resources[ commands[ i ] ];

					passEncoderGPU.setViewport( viewport[ 0 ], viewport[ 1 ], viewport[ 2 ], viewport[ 3 ], viewport[ 4 ], viewport[ 5 ] );
					break;

				}

				case RenderPassCommand.SET_SCISSOR_RECT:

					passEncoderGPU.setScissorRect( commands[ i ], commands[ i + 1 ], commands[ i + 2 ], commands[ i + 3 ] );
					break;

				case RenderPassCommand.SET_STENCIL_REFERENCE:

					passEncoderGPU.setStencilReference( commands[ i ] );
					break;

				case RenderPassCommand.SET_BLEND_CONSTANT:

					passEncoderGPU.setBlendConstant( resources[ commands[ i ] ] );
					break;

				case RenderPassCommand.DRAW:

					passEncoderGPU.draw( commands[ i ], commands[ i + 1 ], commands[ i + 2 ], commands[ i + 3 ] );
					break;

				case RenderPassCommand.DRAW_INDEXED:

					passEncoderGPU.drawIndexed( commands[ i ], commands[ i + 1 ], commands[ i + 2 ], commands[ i + 3 ], commands[ i + 4 ] );
					break;

				case RenderPassCommand.DRAW_INDIRECT:

					passEncoderGPU.drawIndirect( resources[ commands[ i ] ], commands[ i + 1 ] );
					break;

				case RenderPassCommand.DRAW_INDEXED_INDIRECT:

					passEncoderGPU.drawIndexedIndirect( resources[ commands[ i ] ], commands[ i + 1 ] );
					break;

				case RenderPassCommand.EXECUTE_BUNDLES:

					passEncoderGPU.executeBundles( resources[ commands[ i ] ] );
					break;

				case RenderPassCommand.BEGIN_OCCLUSION_QUERY:

					passEncoderGPU.beginOcclusionQuery( commands[ i ] );
					break;

				case RenderPassCommand.END_OCCLUSION_QUERY:

					passEncoderGPU.endOcclusionQuery();
					break;

				case RenderPassCommand.PUSH_DEBUG_GROUP:

					passEncoderGPU.pushDebugGroup( resources[ commands[ i ] ] );
					break;

				case RenderPassCommand.POP_DEBUG_GROUP:

					passEncoderGPU.popDebugGroup();
					break;

				case RenderPassCommand.INSERT_DEBUG_MARKER:

					passEncoderGPU.insertDebugMarker( resources[ commands[ i ] ] );
					break;

				default:

					console.error( `THREE.WebGPURenderPassCommands: Unknown command '${ command }'.` );
					return;

			}

			i += COMMAND_LENGTHS[ command ];

		}

	}

	/**
	 * Empties the recording so the instance can be reused for the next frame,
	 * dropping every reference it held to GPU objects.
	 *
	 * The command stream's buffer is kept, so a pooled recording settles on a
	 * steady state capacity instead of reallocating every frame.
	 *
	 * @return {WebGPURenderPassCommands} A reference to this recording.
	 */
	reset() {

		this.length = 0;
		this.resources.length = 0;
		this.count = 0;
		this.descriptor = null;

		this._resourceIds.clear();

		return this;

	}

}

export default WebGPURenderPassCommands;

export { RenderPassCommand };
