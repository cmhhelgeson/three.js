import { Fn, If, instancedArray, invocationLocalIndex, countTrailingZeros, Loop, workgroupArray, subgroupSize, workgroupBarrier, workgroupId, uint, select, invocationSubgroupIndex, dot, uvec4, vec4, float, subgroupAdd, array, subgroupShuffle, subgroupInclusiveAdd, subgroupBroadcast, invocationSubgroupMetaIndex } from 'three/tsl';

const divRoundUp = ( size, part_size ) => {

	return Math.floor( ( size + part_size - 1 ) / part_size );

};

/**
	* A class that represents a prefix sum running under the reduce/scan strategy.
	* Currently limited to one-dimensional data buffers.
	*
	* @param {Renderer} renderer - A renderer with the ability to execute compute operations.
	* @param {StorageBufferNode} dataBuffer - The data buffer to sum.
	* @param {Object} [options={}] - Options that modify the reduce/scan prefix sum.
	*/
export class PrefixSum {

	/**
	 * Constructs a new light probe helper.
	 *
	 * @param {Renderer} renderer - A renderer with the ability to execute compute operations.
	 * @param {StorageBufferNode} dataBuffer - The data buffer to sum.
	 * @param {Object} [options={}] - Options that modify the behavior of the prefix sum.
	 */
	constructor( renderer, dataBuffer, options = {} ) {

		/**
		 * A reference to the renderer.
		 *
		 * @type {Renderer}
		 */
		this.renderer = renderer;

		/**
		 * A reference to the StorageBufferNode holding the data that will be summed.
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

		/**
		 * The number of 4-dimensional vectors needed to fully represent the data in the data buffer.
		 * Buffers where this.count % 4 !== 0 will need an additional vec4 to hold the data buffer's
		 * remaining elements.
		 *
		 * @type {number}
		 */
		this.vecCount = divRoundUp( this.count, 4 );

		/**
		 * The number of 4-dimensional vectors that will be read from global storage in each invocation of the reduction/downsweep step.
		 * Defaults to 4.
		 *
		 * @type {number}
		*/
		this.workPerInvocation = options.workPerInvocation ? options.workPerInvocation : 4;

		/**
		 * The number of unvectorized values to be read from the reduction buffer in each invocation of the spine/scan step.
		 * Derived from workPerInvocation and thus defaults to 16.
		 *
		 * @type {number}
		*/
		this.unvectorizedWorkPerInvocation = options.workPerInvocation * 4;

		/**
		 * The maximum number of elements that will be read by an individual workgroup in the reduction step.
		 * Calculated as the number of invocations in the workgroup by the work per invocation by VEC4_SIZE
		 *
		 * @type {number}
		*/
		this.partitionSize = this.workgroupSize * this.unvectorizedWorkPerInvocation;

		/**
		 * The number of workgroups needed to properly execute the reduction and downsweepsteps.
		 * Calculated as the number of partitions within the count of elements.
		 *
		 * @type {number}
		*/
		this.numWorkgroups = divRoundUp( this.count, this.partitionSize );

		/**
		 * A reference to the StorageBufferNode holding the reduction of each workgroup in the reduce step.
		 *
		 * @type {StorageBufferNode}
		 */
		this.reductionBuffer = instancedArray( this.numWorkgroups, dataBuffer.nodeType );

		/**
		 * The number of invocations dispatched in each step of the prefix sum.
		 *
		 * @type {number}
		*/
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
		 * A node representing a workgroup scoped buffer that holds the result of a subgroup operation from
		 * each subgroup in a workgroup. Sized to account for minimumn WGSL subgroup size of 4.
		 *
		 * @type {WorkgroupInfoNode}
		*/
		this.subgroupReductionArray = workgroupArray( dataBuffer.nodeType, Math.ceil( this.workgroupSize / 4 ) );

		/**
		 * A node representing a workgroup scoped buffer that holds the result of a subgroup operation from
		 * each subgroup in a workgroup.
		 *
		 * @type {StorageBufferNode}
		*/
		this.workgroupReductionArray = instancedArray( this.numWorkgroups, dataBuffer.nodeType );

		/**
		 * A node representing the vec4-alligned offset at which the workgroup with index 'workgroupId.x'
		 * will begin reading vec4 elements from the data buffer.
		 *
		 * @type {Node<uint>}
		 */
		this.workgroupOffset = workgroupId.x.mul( uint( this.workgroupSize ).mul( this.workPerInvocation ) );

		/**
		 * A node representing the vec4-alligned offset from 'this.workgroupOffset' at which the subgroup with index 'subgroupMetaRank'
		 * will begin reading vec4 elements from a data buffer.
		 *
		 * @type {Node<uint>}
		 */
		this.subgroupOffset = invocationSubgroupMetaIndex.mul( subgroupSize ).mul( this.workPerInvocation );

		/**
		 * A node representing the uint-alligned offset from 'this.workgroupOffset' at which the subgroup with index 'subgroupMetaRank'
		 * will begin reading uint elements from a data buffer.
		 *
		 * @type {Node<uint>}
		 */
		this.unvectorizedSubgroupOffset = invocationSubgroupMetaIndex.mul( subgroupSize ).mul( this.unvectorizedSubgroupOffset );


		/**
		 * A node that evaulates to n in 2^n = subgroupSize
		 *
		 * @type {Node<uint>}
		 */
		this.subgroupSizeLog = countTrailingZeros( subgroupSize ).toVar( 'subgroupSizeLog' );

		/**
		 * A node that calculates the number of partial reductions in a workgroup scan, or the number
		 * of subgroups in a workgroup on the current device.
		 *
		 * @type {Node<uint>}
		 */
		this.spineSize = uint( this.workgroupSize ).shiftRight( this.subgroupSizeLog ).toVar( 'spineSize' );

		/**
		 * A node that evaluates to n in 2^n = spineSize.
		 *
		 * @type {Node<uint>}
		 */
		this.spineSizeLog = countTrailingZeros( this.spineSize ).toVar( 'spineSizeLog' );

		/**
		 * The step of the prefix sum to execute.
		 *
		 * @type {'Reduce' | 'Spine_Scan' | 'Downsweep'}
		*/
		this.currentStep = 'Reduce';


		/**
		 * A compute shader that performs an intermediate reduction step.
		 *
		 * @type {ComputeNode}
		*/
		this.reduceFn = this._getReduceFn();

		/**
		 * A compute shader that performs a spine scan step.
		 *
		 * @type {ComputeNode}
		*/
		this.reduceFn = this._getSpineScanFn();

		/**
		 * A compute shader that performs a downsweep step.
		 *
		 * @type {ComputeNode}
		 */
		this.downsweepFn = this._getDownsweepFn();

	}

	_getSubgroupAlignedSize() {

		const { spineSizeLog, subgroupSizeLog } = this;

		// Align size to powers of subgroupSize
		const squaredSubgroupLog = ( spineSizeLog.add( subgroupSizeLog ).sub( 1 ) );
		squaredSubgroupLog.divAssign( subgroupSizeLog );
		squaredSubgroupLog.mulAssign( subgroupSizeLog );
		const subgroupAlignedSize = ( uint( 1 ).shiftLeft( squaredSubgroupLog ) ).toVar( 'alignedSize' );

		return { subgroupAlignedSize };

	}


	// NOTE: subgroupSizeLog needs to be defined in this._getSubgroupAlignedSize before this block can execute
	_subgroupAlignedSizeBlock( subgroupAlignedSize, subgroupAllignedBlockCallback ) {

		// In cases where the number of subgroups in a workgroup is greater than the subgroup size itself,
		// we need to iterate over the array again to capture all the data in the workgroup array buffer
		// In many cases this loop will only run once
		Loop( { start: subgroupSize, end: subgroupAlignedSize, condition: '<=', name: 'j', type: 'uint', update: '<<= subgroupSizeLog' }, ( { j } ) => {

			subgroupAllignedBlockCallback( j );

		} );

	}

	_getSpineAlignedSize() {

		const { numWorkgroups, partitionSize } = this;

		const SPINE_PARTITION_SIZE = uint( partitionSize ).toVar( 'spinePartitionSize' );

		const spineAlignedSize = ( SPINE_PARTITION_SIZE.add( numWorkgroups ).sub( 1 ) );
		spineAlignedSize.div( SPINE_PARTITION_SIZE );
		spineAlignedSize.mul( SPINE_PARTITION_SIZE );

		return spineAlignedSize;

	}

	_getSpineAlignedBlock( spineAlignedSize, spineAlignedBlockCallback ) {

		// Allignment in cases where num elements is (SPINE_PARTITION_SIZE * SPINE_PARTITION_SIZE) + 1
		Loop( { start: uint( 0 ), end: spineAlignedSize, condition: '<', name: 'j', type: 'uint', update: '+= partitionSize' }, ( { j } ) => {

			spineAlignedBlockCallback( j );

		} );

	}

	_workPerInvocationBlock( workgroupCallback, lastWorkgroupCallback ) {

		const { numWorkgroups, workPerInvocation } = this;

		// Each thread will accumulate values from across 'workPerInvocation' subgroups
		If( workgroupId.x.lessThan( uint( numWorkgroups ).sub( 1 ) ), () => {

			Loop( {
				start: uint( 0 ),
				end: workPerInvocation,
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
				end: workPerInvocation,
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
		const {
			_dataTypeFn,
			_vectorTypeFn,
			vecCount,
			dataBuffer,
			reductionBuffer,
			subgroupReductionArray,
			subgroupOffset,
			workgroupOffset,
			subgroupSizeLog,
			spineSize
		} = this;

		const fnDef = Fn( () => {

			// Each subgroup block scans across 4 subgroups. So when we move into a new subgroup,
			// align that subgroups' accesses to the next 4 subgroups
			const threadSubgroupOffset = subgroupOffset.add( invocationSubgroupIndex );

			const startThreadBase = threadSubgroupOffset.add( workgroupOffset );

			const startThread = startThreadBase.toVar();

			const subgroupReduction = _dataTypeFn( 0 );

			this._workPerInvocationBlock( () => {

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
			// value to be ELEMENTS_PER_VEC4 * workPerInvocation * subgroupSize

			// Delegate one thread per subgroup to assign each subgroup's reduction to the workgroup array
			If( invocationSubgroupIndex.equal( uint( 0 ) ), () => {

				subgroupReductionArray.element( invocationSubgroupMetaIndex ).assign( subgroupReduction );

			} );

			// Ensure that each workgroup has populated the perSubgroupReductionArray with data
			// from each of it's subgroups
			workgroupBarrier();

			// WORKGROUP LEVEL REDUCE

			const { subgroupAlignedSize } = this._getSubgroupAlignedSize();

			// aligned size 2 * 4

			const offset = uint( 0 );

			// In cases where the number of subgroups in a workgroup is greater than the subgroup size itself,
			// we need to iterate over the array again to capture all the data in the workgroup array buffer
			// In many cases this loop will only run once
			this._subgroupAlignedSizeBlock( subgroupAlignedSize, () => {

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

				// TODO: Comment out in prod
				dataBuffer.element( workgroupId.x ).assign( reducedWorkgroupSum );

				reductionBuffer.element( workgroupId.x ).assign( reducedWorkgroupSum );

			} );

		} )().compute( this.dispatchSize, [ this.workgroupSize ] );

		return fnDef;

	}


	// TODO: Spine scan reference code is unvectorized for now, but should be converted to vectorized reference later
	_getSpineScanFn() {

		const {
			subgroupReductionArray,
			_alignedSizeBlock,
			unvectorizedSubgroupOffset,
			unvectorizedWorkPerInvocation,
			spineSize,
			subgroupSizeLog,
			reductionBuffer
		} = this;

		const fnDef = Fn( () => {

			const { subgroupAlignedSize } = this._getSubgroupAlignedSize();
			const { spineAlignedSize } = this._getSpineAlignedSize();

			const t_scan = array( 'uint', 16 );
			const previousReduction = uint( 0 ).toVar( 'previousReduction' );

			this._getSpineAlignedBlock( spineAlignedSize, ( devOffset ) => {

				const reducedWorkgroupIndex = unvectorizedSubgroupOffset.add( devOffset );

				Loop( {
					start: uint( 0 ),
					end: unvectorizedWorkPerInvocation,
					type: 'uint',
					condition: '<',
					update: '+= 1u',
					name: 'k'
				}, ( { k } ) => {

					// The reduction buffer holds a collection of reductions from within
					// each indice's respective workgroup, so ensure that we only access
					// valid workgroup indices

					If( reducedWorkgroupIndex.lessThan( this.numWorkgroups ), () => {

						t_scan.element( k ).assign( reductionBuffer.element( i ) );

					} );

					reducedWorkgroupIndex.addAssign( subgroupSize );

				} );

				const prev = uint( 0 ).toVar( 'prev' );
				Loop( {
					start: uint( 0 ),
					end: unvectorizedWorkPerInvocation,
					type: 'uint',
					condition: '<',
					update: '+= 1u',
					name: 'k'
				}, ( { k } ) => {

					t_scan.element( k ).assign( subgroupInclusiveAdd( t_scan.element( k ) ).add( prev ) );
					prev.assign( subgroupShuffle( t_scan.element( k ), subgroupSize.sub( 1 ) ) );

				} );

				if ( invocationSubgroupIndex.equal( subgroupSize.sub( 1 ) ) ) {

					subgroupReductionArray.element( invocationSubgroupIndex ).assign( prev );

				}

				workgroupBarrier();

				const offset0 = uint( 0 ).toVar();
				const offset1 = uint( 0 ).toVar();

				_alignedSizeBlock( subgroupAlignedSize, ( j ) => {

					const isValidSubgroupIndex = j.notEqual( subgroupSize );
					const isValidSubgroupInt = select( isValidSubgroupIndex, uint( 1 ), uint( 0 ) ).uniformFlow();

					const i0 = ( invocationLocalIndex.add( offset0 ) ).shiftLeft( offset1 ).sub( isValidSubgroupInt );
					const pred0 = i0.lessThan( spineSize );
					const t0 = subgroupInclusiveAdd( select( pred0, subgroupReductionArray.element( i0 ), 0 ).uniformFlow() );

					If( pred0, () => {

						subgroupReductionArray.element( i0 ).assign( t0 );

					} );

					If( isValidSubgroupIndex, () => {

						const rShift = j.shiftRight( subgroupSizeLog );
						const i1 = invocationLocalIndex.add( rShift );

						const weirdValue = i1.bitAnd( j.sub( 1 ) );

						If( weirdValue.greaterThanEqual( rShift ), () => {

							const pred1 = i1.lessThan( spineSize );

							const maskedI1 = ( i1.shiftRight( offset1 ) ).shiftLeft( offset1 );
							const t1 = select( pred1, subgroupReductionArray.element( maskedI1.sub( 1 ) ), 0 ).uniformFlow();

							If(
								pred1.and(
									( i1.add( 1 ).bitAnd( rShift.sub( 1 ) ) ).notEqual( 0 )
								), () => {

									subgroupReductionArray.element( i1 ).addAssign( t1 );

								} );


						} );


					} ).Else( () => {

						offset0.addAssign( 1 );

					} );

					offset1.addAssign( subgroupSizeLog );

				} );

				workgroupBarrier();

				const newPrev = select(
					invocationSubgroupMetaIndex.notEqual( 0 ),
					subgroupReductionArray.element( invocationSubgroupMetaIndex.sub( 1 ) ),
					0
				).uniformFlow().add( previousReduction );

				const i = unvectorizedSubgroupOffset.add( devOffset );

				Loop( {
					start: uint( 0 ),
					end: unvectorizedWorkPerInvocation,
					type: 'uint',
					condition: '<',
					update: '+= 1u',
					name: 'k'
				}, ( { k } ) => {

					If( i.lessThan( this.numWorkgroups ), () => {

						reductionBuffer.element( i ).assign( t_scan.element( k ).add( newPrev ) );

					} );

					i.addAssign( subgroupSize );

					previousReduction.addAssign( subgroupBroadcast( subgroupReductionArray.element( subgroupAlignedSize.sub( 1 ) ), 0 ) );
					workgroupBarrier();


				} );

			} );

		} )().compute( this.workgroupSize, [ this.workgroupSize ] );

		return fnDef;

	}

	_getDownsweepFn() {

		const { workPerInvocation, scanInBuffer, subgroupOffset, workgroupOffset, workgroupSize, subgroupReductionArray, vecCount } = this;

		const fnDef = Fn( () => {

			const threadSubgroupOffset = subgroupOffset.add( invocationSubgroupIndex );

			const startThreadBase = threadSubgroupOffset.add( workgroupOffset );

			const startThread = startThreadBase.toVar();

			const tScan = array( 'uvec4', workPerInvocation );

			// WORKGROUP REDUCE BLOCK

			this._workPerInvocationBlock( ( currentSubgroupInBlock ) => {

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

				// Each thread now has prefix sums of the elements in 'workPerInvocation' vec4s

				const prev = uint( 0 ).toVar();
				const laneMask = subgroupSize.sub( 1 );
				const circularShift = ( invocationSubgroupIndex.add( laneMask ) ).bitAnd( laneMask );

				Loop( {
					start: uint( 0 ),
					end: workPerInvocation,
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

					subgroupReductionArray.element( invocationSubgroupMetaIndex ).assign( prev );

				} );

				workgroupBarrier();


				const offset0 = uint( 0 ).toVar();
				const offset1 = uint( 0 ).toVar();

				const { subgroupSizeLog, spineSize, alignedSize } = this._getAlignmentInfo( workgroupSize );

				// In cases where the number of subgroups in a workgroup is greater than the subgroup size itself,
				// we need to iterate over the array again to capture all the data in the workgroup array buffer
				this._alignedSizeBlock( alignedSize, ( j ) => {

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

				this._workPerInvocationBlock( ( currentSubgroupInBlock ) => {

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

		return fnDef;

	}


	/**
	 * Executes an intermediate reduction operation on the data buffer.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async computeReduce( renderer ) {

		renderer.compute( this.reduceFn );

	}

	/**
	 * Executes a spine scan operation on the data buffer.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async computeSpineScan( renderer ) {

		renderer.compute( this.spineScanFn );

	}

	/**
	 * Executes a downsweep operation on the data buffer.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async computeDownsweep( renderer ) {

		renderer.compute( this.downsweepFn );

	}

	/**
	 * Executes the next subsequent compute step of a prefix sum.
	 *
	 * @param {Renderer} renderer - A renderer with the ability to execute compute operations.
	 */
	async computeStep( renderer ) {

		switch ( this.currentStep ) {

			case 'Reduce': {

				await this.computeReduce( renderer );
				this.currentStep = 'Spine_Scan';
				break;

			}

			case 'Spine_Scan': {

				await this.computeSpineScan( renderer );
				this.currenTstep = 'Downsweep';
				break;

			}

			case 'Downsweep': {

				await this.computeDownsweep( renderer );
				this.currentStep = 'Reduce';
				break;

			}

		}

	}

	/**
	 * Executes a complete prefix sum on the data buffer.
	 *
	 * @param {Renderer} renderer - The current scene's renderer.
	 */
	async compute( renderer ) {

		await this.computeStep( renderer, this.currentStep );
		await this.computeStep( renderer, this.currentStep );
		await this.computeStep( renderer, this.currentStep );

	}

}
