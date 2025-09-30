import { Fn, uvec2, If, instancedArray, instanceIndex, invocationLocalIndex, Loop, workgroupArray, subgroupSize, workgroupBarrier, workgroupId, uint, select, min, max, invocationSubgroupIndex, dot, uvec4, vec4, float, subgroupAdd, log2, arrayBuffer, array, subgroupShuffle, subgroupInclusiveAdd, subgroupBroadcast, subgroupIndex } from 'three/tsl';

const StepType = {
	NONE: 0,
	// Swap all values within the local range of workgroupSize * 2
	SWAP_LOCAL: 1,
	DISPERSE_LOCAL: 2,
	// Swap values within global data buffer.
	FLIP_GLOBAL: 3,
	DISPERSE_GLOBAL: 4,
};


/**
 * Returns the indices that will be compared in a bitonic flip operation.
 *
 * @tsl
 * @private
 * @param {Node<uint>} index - The compute thread's invocation id.
 * @param {Node<uint>} blockHeight - The height of the block within which elements are being swapped.
 * @returns {Node<uvec2>} The indices of the elements in the data buffer being compared.
 */
export const getBitonicFlipIndices = /*@__PURE__*/ Fn( ( [ index, blockHeight ] ) => {

	const blockOffset = ( index.mul( 2 ).div( blockHeight ) ).mul( blockHeight );
	const halfHeight = blockHeight.div( 2 );
	const idx = uvec2(
		index.mod( halfHeight ),
		blockHeight.sub( index.mod( halfHeight ) ).sub( 1 )
	);
	idx.x.addAssign( blockOffset );
	idx.y.addAssign( blockOffset );

	return idx;

} ).setLayout( {
	name: 'getBitonicFlipIndices',
	type: 'uvec2',
	inputs: [
		{ name: 'index', type: 'uint' },
		{ name: 'blockHeight', type: 'uint' }
	]
} );

/**
 * Returns the indices that will be compared in a bitonic sort's disperse operation.
 *
 * @tsl
 * @private
 * @param {Node<uint>} index - The compute thread's invocation id.
 * @param {Node<uint>} swapSpan - The maximum span over which elements are being swapped.
 * @returns {Node<uvec2>} The indices of the elements in the data buffer being compared.
 */
export const getBitonicDisperseIndices = /*@__PURE__*/ Fn( ( [ index, swapSpan ] ) => {

	const blockOffset = ( ( index.mul( 2 ) ).div( swapSpan ) ).mul( swapSpan );
	const halfHeight = swapSpan.div( 2 );
	const idx = uvec2(
		index.mod( halfHeight ),
		( index.mod( halfHeight ) ).add( halfHeight )
	);

	idx.x.addAssign( blockOffset );
	idx.y.addAssign( blockOffset );

	return idx;

} ).setLayout( {
	name: 'getBitonicDisperseIndices',
	type: 'uvec2',
	inputs: [
		{ name: 'index', type: 'uint' },
		{ name: 'blockHeight', type: 'uint' }
	]
} );


const divRoundUp = ( size, part_size ) => {

	return Math.floor( ( size + part_size - 1 ) / part_size );

};


/**
	 * A class that represents a prefix sum running under the reduce/scan strategy.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 * @param {StorageBufferNode} dataBuffer - The data buffer to sum.
	 * @param {Object} [options={}] - Options that modify the reduce/scan prefix sum.
	 */
export class PrefixSum {

	/**
	 * Constructs a new light probe helper.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 * @param {StorageBufferNode} dataBuffer - The data buffer to sort.
	 * @param {Object} [options={}] - Options that modify the bitonic sort.
	 */
	constructor( renderer, dataBuffer, options = {} ) {

		/**
		 * A reference to the renderer.
		 *
		 * @type {Renderer}
		 */
		this.renderer = renderer;

		/**
		 * A reference to the StorageBufferNode holding the data that will be sorted  .
		 *
		 * @type {StorageBufferNode}
		 */
		this.dataBuffer = dataBuffer;

		/**
		 * The size of the data.
		 *
		 * @type {number}
		 */
		this.count = dataBuffer.value.count;

		this.outputBuffer = instancedArray( this.count, this.dataBuffer.nodeType );

		/**
		 * The number of 4-dimensional vectors needed to represent that data in the data buffer.
		 *
		 * @type {number}
		 */
		this.vecCount = divRoundUp( this.count, 4 );

		/**
		 * The number of vectors being read from global storage in each thread of the reduction step.
		 * Defaults to 4.
		 *
		 * @type {number}
		*/
		this.workPerThread = options.workPerThread ? options.workPerThread : 4;

		/**
		 * The maximum number of elements that will be read by an individual workgroup in the reduction step.
		 *
		 * @type {number}
		*/
		this.partitionSize = this.workgroupSize * this.reductionWorkPerThread * 4;

		/**
		 * The number of workgroups needed to properly execute the reduction and downsweepsteps.
		 *
		 * @type {number}
		*/
		this.numWorkgroups = divRoundUp( this.count, this.partitionSize );

		this.dispatchSize = this.numWorkgroups * this.workgroupSize;


		/**
		 * The valid vec4 type that can be used to hold data from the data buffer.
		 *
		 * @type {number}
		*/
		this._vectorTypeFn = this.nodeType === 'uint' ? uvec4 : vec4;


		/**
		 * The valid data type that used to hold data from the data buffer.
		 *
		 * @type {number}
		*/
		this._dataTypeFn = this.nodeType === 'uint' ? uint : float;


		/**
		 * The workgroup size of the compute shaders executed during the prefix sum.
		 * If no workgroupSize is defined, the workgroupSize defaults to the minimumn between the number of elements in the
		 * data buffer and 64.
		 *
		 * @type {StorageBufferNode}
		*/
		this.workgroupSize = options.workgroupSize ? options.workgroupSize : Math.min( this.dispatchSize, 64 );


		/**
		 * The minimumn size of a subgroup on this device.
		 * If the device's subgroup is not passed in, a minimumn subgroup size of 4 is presumed.
		 *
		 * @type {number}
		*/
		this.minSubgroupSize = options.minSubgroupSize ? options.minSubgroupSize : 4;


		/**
		 * The number of subgroups in a workgroup.
		 *
		 * @type {number}
		*/
		this.numSubgroupsInWorkgroup = Math.ceil( this.workgroupSize / this.minSubgroupSize );

		/**
		 * A node representing a workgroup scoped buffer that holds the result of a subgroup operation from
		 * each subgroup in a workgroup.
		 *
		 * @type {WorkgroupInfoNode}
		*/
		this.subgroupReductionArray = workgroupArray( dataBuffer.nodeType, this.numSubgroupsInWorkgroup );

		/**
		 * A node representing a workgroup scoped buffer that holds the result of a subgroup operation from
		 * each subgroup in a workgroup.
		 *
		 * @type {StorageBufferNode}
		*/
		this.workgroupReductionArray = instancedArray( this.numWorkgroups, dataBuffer.nodeType );



		/**
		 * A node representing the rank of a subgroup within its workgroup.
		 *
		 * @type {Node}
		*/
		this.subgroupMetaRank = invocationLocalIndex.div( subgroupSize );

		this.subgroupOffset = this.subgroupMetaRank.mul( subgroupSize ).mul( this.workPerThread );

		// Per workgroup, offset by number of vectorized elements scanned per workgroup
		this.workgroupOffset = workgroupId.x.mul( uint( this.workgroupSize ).mul( this.workPerThread ) );

		/**
		 * A node representing the rank of a subgroup within its workgroup.
		 *
		 * @type {'Reduce' | 'Spine_Scan' | 'Downsweep'}
		*/
		this.currentStep = 'Reduce';

		// REDUCTION INFO


		this.reduceFn = this._getReduceFn();


		/**
		 * The current compute shader dispatch within the list of dispatches needed to complete the sort.
		 *
		 * @type {number}
		*/
		this.currentDispatch = 0;

		/**
		 * The number of global swap operations that must be executed before the sort
		 * can swap in local address space.
		 *
		 * @type {number}
		*/
		this.globalOpsRemaining = 0;

		/**
		 * The total number of global operations needed to sort elements within the current swap span.
		 *
		 * @type {number}
		*/
		this.globalOpsInSpan = 0;

	}

	_getAlignmentInfo( workgroupSize ) {

		// Multiple approaches here
		// log2(subgroupSize) -> TSL log2 function
		// countTrailingZeros/findLSB(subgroupSize) -> Currently unsupported function in TSL that counts trailing zeros in number bit representation
		// Can technically petition GPU for subgroupSize in shader and calculate logs on CPU at cost of shader being generalizable across devices
		// May also break if subgroupSize changes when device is lost or if program is rerun on lower power device
		const subgroupSizeLog = uint( log2( float( subgroupSize ) ) ).toVar( 'subgroupSizeLog' );
		const spineSize = uint( workgroupSize ).shiftRight( subgroupSizeLog );
		const spineSizeLog = uint( log2( float( spineSize ) ) ).toVar( 'spineSizeLog' );

		// Align size to powers of subgroupSize
		const squaredSubgroupLog = ( spineSizeLog.add( subgroupSizeLog ).sub( 1 ) );
		squaredSubgroupLog.divAssign( subgroupSizeLog );
		squaredSubgroupLog.mulAssign( subgroupSizeLog );
		const alignedSize = ( uint( 1 ).shiftLeft( squaredSubgroupLog ) ).toVar( 'alignedSize' );

		return { subgroupSizeLog, spineSize, spineSizeLog, alignedSize };

	}

	_workPerThreadBlock( workgroupCallback, lastWorkgroupCallback ) {

		const { numWorkgroups, workPerThread } = this;

		// Each thread will accumulate values from across 'workPerThread' subgroups
		If( workgroupId.x.lessThan( uint( numWorkgroups ).sub( 1 ) ), () => {

			Loop( {
				start: uint( 0 ),
				end: workPerThread,
				type: 'uint',
				condition: '<',
				name: 'currentSubgroupInBlock'
			}, ( { currentSubgroupInBlock } ) => {

				workgroupCallback( currentSubgroupInBlock );

			} );

		} );

		// Ensure that the last workgroup does not access out of bounds indices
		If( workgroupId.x.equal( uint( numWorkgroups ).sub( 1 ) ), () => {

			Loop( {
				start: uint( 0 ),
				end: workPerThread,
				type: 'uint',
				condition: '<',
				name: 'currentSubgroupInBlock'
			}, ( { currentSubgroupInBlock } ) => {

				lastWorkgroupCallback( currentSubgroupInBlock );

			} );

		} );

	}


	_getReduceFn() {

		// Can't pass in subgroup size since we can't always be certain what size is at runtime
		const { _dataTypeFn, _vectorTypeFn, vecCount, dataBuffer, subgroupMetaRank, subgroupReductionArray, workgroupSize, subgroupOffset, workgroupOffset } = this;

		const fnDef = Fn( () => {

			// Each subgroup block scans across 4 subgroups. So when we move into a new subgroup,
			// align that subgroups' accesses to the next 4 subgroups
			const threadSubgroupOffset = subgroupOffset.add( invocationSubgroupIndex );

			const startThreadBase = threadSubgroupOffset.add( workgroupOffset );

			const startThread = startThreadBase.toVar();

			const subgroupReduction = _dataTypeFn( 0 );

			this._workPerThreadBlock( () => {

				// Get vectorized element from input array
				const val = dataBuffer.element( startThread );

				// Sum values within vec4 together by using result of dot product
				subgroupReduction.addAssign( dot( _vectorTypeFn( 1 ), val ) );

				// Increment so thread will scan value in next subgroup
				startThread.addAssign( subgroupSize );


			}, () => {

				// Ensure index is less than number of available vectors in inputBuffer
				const val = select( startThread.lessThan( uint( vecCount ) ), dataBuffer.element( startThread ), this._vectorTypeFn( 0 ) ).uniformFlow();

				subgroupReduction.addAssign( dot( val, this._vectorTypeFn( 1 ) ) );
				startThread.addAssign( subgroupSize );


			} );

			subgroupReduction.assign( subgroupAdd( subgroupReduction ) );

			// Assuming that each element in the input buffer is 1, we generally expect each invocation's subgroupReduction
			// value to be ELEMENTS_PER_VEC4 * workPerThread * subgroupSize

			// Delegate one thread per subgroup to assign each subgroup's reduction to the workgroup array
			If( invocationSubgroupIndex.equal( uint( 0 ) ), () => {

				subgroupReductionArray.element( subgroupMetaRank ).assign( subgroupReduction );

			} );

			// Ensure that each workgroup has populated the perSubgroupReductionArray with data
			// from each of it's subgroups
			workgroupBarrier();

			// WORKGROUP LEVEL REDUCE

			const { subgroupSizeLog, spineSizeLog, spineSize, alignedSize } = this._getAlignmentInfo( workgroupSize );

			// aligned size 2 * 4

			const offset = uint( 0 );

			// In cases where the number of subgroups in a workgroup is greater than the subgroup size itself,
			// we need to iterate over the array again to capture all the data in the workgroup array buffer
			Loop( { start: subgroupSize, end: alignedSize, condition: '<=', name: 'j', type: 'uint', update: '<<= subgroupSizeLog' }, () => {

				const subgroupIndex = ( ( invocationLocalIndex.add( 1 ) ).shiftLeft( offset ) ).sub( 1 );

				const isValidSubgroupIndex = subgroupIndex.lessThan( spineSize ).toVar( 'isValidSubgroupIndex' );

				// Reduce values within the local workgroup memory.
				// Set toVar to ensure subgroupAdd executes before (not within) the if statement.
				const t = subgroupAdd(
					select(
						isValidSubgroupIndex,
						subgroupReductionArray.element( subgroupIndex ),
						0
					).uniformFlow()
				).toVar( 't' );

				// Can assign back to workgroupArray since all
				// subgroup threads work in lockstop for subgroupAdd
				If( isValidSubgroupIndex, () => {

					subgroupReductionArray.element( subgroupIndex ).assign( t );

				} );

				// Ensure all threads have completed work

				workgroupBarrier();

				offset.addAssign( subgroupSizeLog );

			} );

			// Assign single thread from workgroup to assign workgroup reduction
			If( invocationLocalIndex.equal( uint( 0 ) ), () => {

				const reducedWorkgroupSum = subgroupReductionArray.element( uint( spineSize ).sub( 1 ) );
				dataBuffer.element( workgroupId.x ).assign( reducedWorkgroupSum );

			} );

		} )().compute( this.dispatchSize, [ this.workgroupSize ] );

		return fnDef;

	}

	_getSpineScanFn() {

		const fnDef = Fn( () => {



		} )().compute( this.workgroupSize, [ this.workgroupSize ] );

	}

	_getDownsweepFn() {

		const { workPerThread, scanInBuffer, subgroupOffset, workgroupOffset, subgroupMetaRank, workgroupSize, subgroupReductionArray, vecCount } = this;

		const fnDef = Fn( () => {

			const threadSubgroupOffset = subgroupOffset.add( invocationSubgroupIndex );

			const startThreadBase = threadSubgroupOffset.add( workgroupOffset );

			const startThread = startThreadBase.toVar();

			const tScan = array( 'uvec4', workPerThread );

			// WORKGROUP REDUCE BLOCK

			this._workPerThreadBlock( ( currentSubgroupInBlock ) => {

				const scanIn = scanInBuffer.element( startThread );
				const currentTScanElement = tScan.element( currentSubgroupInBlock );

				currentTScanElement.assign( scanIn );

				currentTScanElement.y.assign( currentTScanElement.x );
				currentTScanElement.z.assign( currentTScanElement.y );
				currentTScanElement.w.assign( currentTScanElement.z );

				startThread.addAssign( subgroupSize );

			}, ( currentSubgroupInBlock ) => {

				If( startThread.lessThan( vecCount ), () => {

					const scanIn = scanInBuffer.element( startThread );
					const currentTScanElement = tScan.element( currentSubgroupInBlock );

					currentTScanElement.assign( scanIn );

					currentTScanElement.y.assign( currentTScanElement.x );
					currentTScanElement.z.assign( currentTScanElement.y );
					currentTScanElement.w.assign( currentTScanElement.z );

					startThread.addAssign( subgroupSize );

				} );

				// Each thread now has prefix sums of the elements in 'workPerThread' vec4s

				const prev = uint( 0 ).toVar();
				const laneMask = subgroupSize.sub( 1 );
				const circularShift = ( invocationSubgroupIndex.add( laneMask ) ).bitAnd( laneMask );

				Loop( {
					start: uint( 0 ),
					end: workPerThread,
					type: 'uint',
					condition: '<',
					name: 'currentSubgroupInBlock'
				}, ( { currentSubgroupInBlock } ) => {

					const t = subgroupShuffle(
						subgroupInclusiveAdd( tScan.element( currentSubgroupInBlock ).w ),
						circularShift
					);

					const addEle = prev.add( select( invocationSubgroupIndex.notEqual( 0 ), t, uint( 0 ) ).uniformFlow() );

					tScan.element( currentSubgroupInBlock ).addAssign( addEle );

					prev.addAssign( subgroupBroadcast( t, uint( 0 ) ) );

				} );

				If( invocationSubgroupIndex.equal( 0 ), () => {

					subgroupReductionArray.element( subgroupIndex ).assign( prev );

				} );

				workgroupBarrier();


				const offset0 = uint( 0 ).toVar();
				const offset1 = uint( 0 );

				const { subgroupSizeLog, spineSizeLog, spineSize, alignedSize } = this._getAlignmentInfo( workgroupSize );

				// In cases where the number of subgroups in a workgroup is greater than the subgroup size itself,
				// we need to iterate over the array again to capture all the data in the workgroup array buffer
				Loop( { start: subgroupSize, end: alignedSize, condition: '<=', name: 'j', type: 'uint', update: '<<= subgroupSizeLog' }, ( { j } ) => {

					const i0 = (
						( invocationLocalIndex.add( offset0 ) ).shiftLeft( offset1 )
					).sub( offset0 );

					const pred0 = i0.lessThan( spineSize );

					const t0 = subgroupInclusiveAdd(
						select( pred0, subgroupReductionArray.element( i0 ), uint( 0 ) )
					);

					If( pred0, () => {

						subgroupReductionArray.element( i0 ).assign( t0 );

					} );

					workgroupBarrier();

					If( j.notEqual( subgroupSize ), () => {

						const rShift = j.shiftRight( subgroupSizeLog );
						const i1 = invocationLocalIndex.add( rShift );
						If( ( i1.and( j.sub( 1 ) ) ).greaterThanEqual( rShift ), () => {

							const pred1 = i1.lessThan( spineSize );
							const t1 = select( pred1, );


						} );


					} ).Else( () => {

						offset1.addAssign( subgroupSizeLog );


					} );

				} );

				workgroupBarrier();

				// LAST BLOCK

				startThread.assign( startThreadBase );

				this._workPerThreadBlock( ( currentSubgroupInBlock ) => {

					const sweepValue = tScan.element( currentSubgroupInBlock ).add( prev );
					this.outputBuffer.element( startThread ).assign( sweepValue );
					startThread.addAssign( subgroupSize );

				}, ( currentSubgroupInBlock ) => {

					If( startThread.lessThan( vecCount ), () => {

						const sweepValue = tScan.element( currentSubgroupInBlock ).add( prev );
						this.outputBuffer.element( startThread ).assign( sweepValue );
						startThread.addAssign( subgroupSize );

					} );

				} );



			} );


		} )().compute( this.dispatchSize, [ this.workgroupSize ] );

	}

	/**
	 * Executes a step of the bitonic sort operation.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async computeStep( renderer ) {

		switch ( this.currentStep ) {

			case 'Reduce': {

				await this.computeReduce( renderer );
				break;

			}

			case 'Spine_Scan': {

				await this.computeSpineScan( renderer );
				break;

			}

			case 'Downsweep': {

				await this.computeDownsweep( renderer );
				break;

			}

		}

	}

	/**
	 * Executes a complete bitonic sort on the data buffer.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async compute( renderer ) {

		await this.computeStep( renderer, this.currentStep );
		await this.computeStep( renderer, this.currentStep );
		await this.computeStep( renderer, this.currentStep );

	}

}
