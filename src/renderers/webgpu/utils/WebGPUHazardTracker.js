/**
 * Reports the write hazards the WebGPU backend would run into if it submitted the commands of a task in one
 * batch instead of submitting every render, compute and copy call on its own.
 *
 * `queue.writeBuffer()`, `queue.writeTexture()` and `queue.copyExternalImageToTexture()` run on the queue timeline
 * before the commands of the next `queue.submit()`. In a batch, writing a resource that an earlier command of the
 * same batch uses therefore changes what that command sees. Destroying such a resource invalidates the whole batch.
 *
 * Nothing is batched here. A batch is simulated: it starts with the first command after the previous one closed and
 * is closed by a microtask, by a readback ( which must submit first ) and by every conflict ( a split on conflict ).
 * Results are reported per frame in `renderer.info.backend`, see {@link WebGPUInfo}.
 *
 * Tracked uses: the buffers and textures of bind groups, vertex, index and indirect buffers ( per draw and dispatch,
 * for render bundles when they are executed ) and the textures of texture copies. Not tracked: render pass attachments
 * and the passes of mipmap generation.
 *
 * Enabled with the `trackHazards` parameter of the backend, which must be set before rendering.
 *
 * @private
 */
class WebGPUHazardTracker {

	/**
	 * Constructs a new hazard tracker.
	 *
	 * @param {WebGPUBackend} backend - The WebGPU backend.
	 */
	constructor( backend ) {

		/**
		 * The WebGPU backend.
		 *
		 * @type {WebGPUBackend}
		 */
		this.backend = backend;

		/**
		 * The id of the current batch.
		 *
		 * @type {number}
		 */
		this.batch = 0;

		/**
		 * Whether the current batch holds any commands.
		 *
		 * @private
		 * @type {boolean}
		 */
		this._batchUsed = false;

		/**
		 * The batch that last used a GPU buffer or texture.
		 *
		 * @private
		 * @type {WeakMap<(GPUBuffer|GPUTexture),number>}
		 */
		this._lastUse = new WeakMap();

		/**
		 * The GPU buffers and textures referenced by a bind group.
		 *
		 * @private
		 * @type {WeakMap<GPUBindGroup,Array<(GPUBuffer|GPUTexture)>>}
		 */
		this._bindGroupResources = new WeakMap();

		/**
		 * The GPU buffers and textures used by the commands of a render bundle, collected while it is recorded and
		 * marked as used whenever it is executed.
		 *
		 * @private
		 * @type {WeakMap<(GPURenderBundleEncoder|GPURenderBundle),Set<(GPUBuffer|GPUTexture)>>}
		 */
		this._bundleResources = new WeakMap();

	}

	/**
	 * Whether hazards are tracked.
	 *
	 * @type {boolean}
	 * @readonly
	 */
	get enabled() {

		return this.backend.trackHazards;

	}

	/**
	 * Notes that a command is added to the current batch, scheduling the microtask that closes it.
	 */
	encode() {

		if ( this._batchUsed === true ) return;

		this._batchUsed = true;

		const batch = this.batch;

		queueMicrotask( () => {

			if ( this.batch === batch ) this.closeBatch();

		} );

	}

	/**
	 * Closes the current batch, as a submit would.
	 */
	closeBatch() {

		if ( this._batchUsed === true ) {

			const info = this.backend.renderer.info;

			if ( info.backend !== undefined ) info.backend.batches ++;

		}

		this.batch ++;
		this._batchUsed = false;

	}

	/**
	 * Saves the GPU buffers and textures a bind group references.
	 *
	 * @param {GPUBindGroup} bindGroupGPU - The bind group.
	 * @param {Array<(GPUBuffer|GPUTexture)>} resources - The referenced buffers and textures.
	 */
	setBindGroupResources( bindGroupGPU, resources ) {

		this._bindGroupResources.set( bindGroupGPU, resources );

	}

	/**
	 * Marks a GPU buffer or texture as used by a command of the given encoder.
	 *
	 * @param {(GPUBuffer|GPUTexture)} resource - The buffer or texture.
	 * @param {(GPURenderPassEncoder|GPUComputePassEncoder|GPURenderBundleEncoder)} encoder - The encoder recording the command.
	 */
	use( resource, encoder ) {

		if ( encoder instanceof GPURenderBundleEncoder ) {

			let resources = this._bundleResources.get( encoder );

			if ( resources === undefined ) {

				resources = new Set();
				this._bundleResources.set( encoder, resources );

			}

			resources.add( resource );

		} else {

			this.encode();

			this._lastUse.set( resource, this.batch );

		}

	}

	/**
	 * Marks the GPU buffers and textures of a bind group as used by a command of the given encoder.
	 *
	 * @param {GPUBindGroup} bindGroupGPU - The bind group.
	 * @param {(GPURenderPassEncoder|GPUComputePassEncoder|GPURenderBundleEncoder)} encoder - The encoder recording the command.
	 */
	useBindGroup( bindGroupGPU, encoder ) {

		const resources = this._bindGroupResources.get( bindGroupGPU );

		if ( resources === undefined ) return;

		for ( let i = 0, l = resources.length; i < l; i ++ ) {

			this.use( resources[ i ], encoder );

		}

	}

	/**
	 * Hands the resources collected while recording a render bundle over to the finished bundle.
	 *
	 * @param {GPURenderBundleEncoder} encoder - The bundle encoder.
	 * @param {GPURenderBundle} bundle - The finished bundle.
	 */
	finishBundle( encoder, bundle ) {

		const resources = this._bundleResources.get( encoder );

		if ( resources !== undefined ) {

			this._bundleResources.delete( encoder );
			this._bundleResources.set( bundle, resources );

		}

	}

	/**
	 * Marks the resources of executed render bundles as used.
	 *
	 * @param {Array<GPURenderBundle>} bundles - The executed bundles.
	 */
	executeBundles( bundles ) {

		this.encode();

		for ( const bundle of bundles ) {

			const resources = this._bundleResources.get( bundle );

			if ( resources === undefined ) continue;

			for ( const resource of resources ) this._lastUse.set( resource, this.batch );

		}

	}

	/**
	 * Checks a queue write to a GPU buffer or texture. If the current batch uses the resource, the write is
	 * counted as a conflict and the batch is split.
	 *
	 * @param {(GPUBuffer|GPUTexture)} resource - The written buffer or texture.
	 * @param {string} type - The kind of resource: `uniform`, `attribute`, `storage`, `indirect` or `texture`.
	 */
	write( resource, type ) {

		if ( this._lastUse.get( resource ) !== this.batch ) return;

		const info = this.backend.renderer.info;

		if ( info.backend !== undefined ) info.backend.conflicts[ type ] ++;

		this.closeBatch();

	}

	/**
	 * Checks the destruction of a GPU buffer or texture. If the current batch uses the resource, it is counted as
	 * a conflict and the batch is closed, since the batch would have to be submitted first.
	 *
	 * @param {(GPUBuffer|GPUTexture)} resource - The destroyed buffer or texture.
	 */
	destroy( resource ) {

		this.write( resource, 'destroy' );

	}

}

export default WebGPUHazardTracker;
