import { Fn, uvec2, If, instancedArray, instanceIndex, invocationLocalIndex, Loop, workgroupArray, workgroupBarrier, workgroupId, uint, select, Switch, Return } from 'three/tsl';

const StepType = {

	NONE: 0,
	// Swap all values within the local range of workgroupSize * 2
	SWAP_LOCAL: 1,
	DISPERSE_LOCAL: 2,
	// Swap values within global data buffer.
	FLIP_GLOBAL: 3,
	DISPERSE_GLOBAL: 4,

};

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

}, { index: 'uint', blockHeight: 'uint', return: 'uvec2' } );

export const getBitonicDisperseIndices = /*@__PURE__*/ Fn( ( [ index, blockHeight ] ) => {

	const blockOffset = ( ( index.mul( 2 ) ).div( blockHeight ) ).mul( blockHeight );
	const halfHeight = blockHeight.div( 2 );
	const idx = uvec2(
		index.mod( halfHeight ),
		( index.mod( halfHeight ) ).add( halfHeight )
	);

	idx.x.addAssign( blockOffset );
	idx.y.addAssign( blockOffset );

	return idx;

}, { index: 'uint', blockHeight: 'uint', return: 'uvec2' } );

// TODO: Add parameters for computing a buffer larger than vec4
export class BitonicSort {

	constructor( renderer, dataBuffer, options = {} ) {

		// Arguments
		this.renderer = renderer;
		this.dataBuffer = dataBuffer;
		this.workgroupSize = options.workgroupSize ? options.workgroupSize : 64;
		this.sideEffectBuffers = options.sideEffectBuffers ? options.sideEffectBuffers : [];
		this.count = dataBuffer.value.count;

		// Helper bufferes
		this.localStorage = workgroupArray( 'uint', this.workgroupSize * 2 );
		this.tempStorage = instancedArray( dataBuffer.value.count, 'uint' );
		this.infoStorage = instancedArray( new Uint32Array( 1, 2, 2 ), 'uint' );

		this.swapOpCount = this._getSwapOpCount( dataBuffer.value.count );
		this.dispatchCount = this._getDispatchCount();

		this.sortFn = this._getSortFn();
		this.setAlgoFn = this._getSetAlgoFn();
		this.alignFn = this._getAlignFn();
		this.resetFn = this._getResetFn();

		this.globalOpsRemaining = 0;
		this.globalOpsInSpan = 0;

		this.dispatchFn = [];

	}

	_getSwapOpCount() {

		const n = Math.log2( this.count );
		return ( n * ( n + 1 ) ) / 2;

	}

	_getDispatchCount() {

		const logElements = Math.log2( this.count );
		const logSwapSpan = Math.log2( this.workgroupSize * 2 );

		const numGlobalFlips = logElements - logSwapSpan;

		// Start with 1 for initial sort over all local elements
		let numDispatches = 1;

		for ( let i = 1; i <= numGlobalFlips; i ++ ) {

			// Increment by swap's global operations and alignments
			numDispatches += i * 2;
			// Increment by alignment (1 per global op)
			numDispatches += i;
			// Increment by local sort
			numDispatches += 1;

		}

		this.dispatchCount = numDispatches;

	}

	_getSortFn() {

		const { infoStorage, tempStorage, localStorage, dataBuffer, workgroupSize } = this;

		const localCompareAndSwap = ( idxBefore, idxAfter ) => {

			If( localStorage.element( idxAfter ).lessThan( localStorage.element( idxBefore ) ), () => {

				const temp = localStorage.element( idxBefore ).toVar();
				localStorage.element( idxBefore ).assign( localStorage.element( idxAfter ) );
				localStorage.element( idxAfter ).assign( temp );

			} );

		};

		const globalCompareAndSwap = ( idxBefore, idxAfter ) => {

			// If the later element is less than the current element
			If( dataBuffer.element( idxAfter ).lessThan( dataBuffer.element( idxBefore ) ), () => {

				tempStorage.element( idxBefore ).assign( dataBuffer.element( idxAfter ) );
				tempStorage.element( idxAfter ).assign( dataBuffer.element( idxBefore ) );

			} ).Else( () => {

				// Otherwise apply the existing values to temporary storage.
				tempStorage.element( idxBefore ).assign( dataBuffer.element( idxBefore ) );
				tempStorage.element( idxAfter ).assign( dataBuffer.element( idxAfter ) );

			} );

		};

		const currentAlgo = infoStorage.element( 0 );
		const currentSwapSpan = infoStorage.element( 1 );

		const fnDef = Fn( () => {

			// Get ids of indices needed to populate workgroup local buffer.
			// Use .toVar() to prevent these values from being recalculated multiple times.
			const localOffset = uint( this.workgroupSize ).mul( 2 ).mul( workgroupId.x ).toVar();

			const localID1 = invocationLocalIndex.mul( 2 );
			const localID2 = invocationLocalIndex.mul( 2 ).add( 1 );

			// If we will perform a local swap, then populate the local data
			If( currentAlgo.lessThanEqual( uint( StepType.DISPERSE_LOCAL ) ), () => {

				localStorage.element( localID1 ).assign( dataBuffer.element( localOffset.add( localID1 ) ) );
				localStorage.element( localID2 ).assign( dataBuffer.element( localOffset.add( localID2 ) ) );

			} );

			// Ensure that all local data has populated
			workgroupBarrier();


			// Perform a chunk of the sort in a single pass that operates entirely in workgroup local space
			Switch( currentAlgo ).Case( StepType.SWAP_LOCAL, () => {

				// SWAP_LOCAL will always be first pass, so we start with known block height of 2
				const flipBlockHeight = uint( 2 );

				Loop( flipBlockHeight.lessThan( workgroupSize * 2 ), () => {

					// Ensure that last dispatch block executed
					workgroupBarrier();

					const flipIdx = getBitonicFlipIndices( invocationLocalIndex, flipBlockHeight );
					localCompareAndSwap( flipIdx.x, flipIdx.y );

					const localBlockHeight = flipBlockHeight.toVar();

					Loop( localBlockHeight.greaterThan( 1 ), () => {

						// Ensure that last dispatch op executed
						workgroupBarrier();

						const disperseIdx = getBitonicFlipIndices( invocationLocalIndex, localBlockHeight );
						localCompareAndSwap( disperseIdx.x, disperseIdx.y );

						localBlockHeight.divAssign( 2 );

					} );

					// flipBlockHeight *= 2;
					flipBlockHeight.shiftLeftAssign( 1 );

				} );

			} ).Case( StepType.DISPERSE_LOCAL, () => {

				const localBlockHeight = currentSwapSpan.toVar();

				Loop( localBlockHeight.greaterThan( 1 ), () => {

					workgroupBarrier();

					const idx = getBitonicDisperseIndices( invocationLocalIndex, localBlockHeight );
					localCompareAndSwap( idx.x, idx.y );

					localBlockHeight.divAssign( 2 );

				} );

			} ).Case( StepType.FLIP_GLOBAL, () => {

				const idx = getBitonicFlipIndices( instanceIndex, currentSwapSpan );
				globalCompareAndSwap( idx.x, idx.y );

			} ).Case( StepType.DISPERSE_GLOBAL, () => {

				const idx = getBitonicDisperseIndices( instanceIndex, currentSwapSpan );
				globalCompareAndSwap( idx.x, idx.y );

			} ).Default( () => {

				Return();

			} );

			// Ensure that all invocations have swapped their own regions of data
			workgroupBarrier();

			// Populate output data with the results from our swaps
			If( currentAlgo.lessThanEqual( uint( StepType.DISPERSE_LOCAL ) ), () => {

				dataBuffer.element( localOffset.add( localID1 ) ).assign( localStorage.element( localID1 ) );
				dataBuffer.element( localOffset.add( localID2 ) ).assign( localStorage.element( localID2 ) );

			} );

		} );

		return fnDef;

	}

	_getResetFn() {

		const fnDef = Fn( () => {

			const { infoStorage } = this;

			const currentAlgo = infoStorage.element( 0 );
			const currentSwapSpan = infoStorage.element( 1 );
			const maxSwapSpan = infoStorage.element( 2 );

			currentAlgo.assign( StepType.SWAP_LOCAL );
			currentSwapSpan.assign( 2 );
			maxSwapSpan.assign( 2 );

		} )().compute( 1 );

		return fnDef;

	}

	_getAlignFn() {

		const { dataBuffer, tempStorage } = this;

		// TODO: Only do this in certain instances by ping-ponging which buffer gets sorted
		// And only aligning if numDispatches % 2 === 1
		const fnDef = Fn( () => {

			dataBuffer.element( instanceIndex ).assign( tempStorage.element( instanceIndex ) );

		} )().compute( this.count, [ this.workgroupSize ] );

		return fnDef;

	}

	_getSetAlgoFn() {

		const fnDef = Fn( () => {

			const { infoStorage, workgroupSize } = this;

			const currentAlgo = infoStorage.element( 0 );
			const currentSwapSpan = infoStorage.element( 1 );
			const maxSwapSpan = infoStorage.element( 2 );

			Switch( currentAlgo ).Case( StepType.SWAP_LOCAL, () => {

				currentAlgo.assign( StepType.FLIP_GLOBAL );
				currentSwapSpan.assign( workgroupSize * 4 );
				maxSwapSpan.assign( workgroupSize * 4 );

			} ).Case( StepType.DISPERSE_LOCAL, () => {

				const nextHighestSwapSpan = maxSwapSpan.mul( 2 );

				currentAlgo.assign( StepType.FLIP_GLOBAL );
				currentSwapSpan.assign( nextHighestSwapSpan );
				maxSwapSpan.assign( nextHighestSwapSpan );

			} ).Default( () => {

				const nextSwapSpan = currentSwapSpan.div( 2 );
				currentAlgo.assign( select( nextSwapSpan.lessThanEqual( workgroupSize.mul( 2 ), StepType.DISPERSE_LOCAL, StepType.DISPERSE_GLOBAL ) ).uniformFlow() );
				currentSwapSpan.assign( nextSwapSpan );

			} );

		} )().compute( 1 );

		return fnDef;

	}

	computeStep( renderer ) {

		renderer.compute( this.sortFn );
		renderer.compute( this.setAlgoFn );

		if ( this.globalOpsRemaining > 0 ) {

			renderer.compute( this.alignFn );

			this.globalOpsRemaining -= 1;

		} else {

			const nextSpanGlobalOps = this.globalOpsInSpan + 1;
			this.globalOpsInSpan = nextSpanGlobalOps;
			this.globalOpsRemaining = nextSpanGlobalOps;


		}

		this.currentDispatch += 1;

		if ( this.currentDispatch === this.dispatchCount ) {

			renderer.compute( this.resetFn );

		}

	}


	compute( renderer ) {

		this.globalOpsRemaining = 0;
		this.maxGlobalOp = 0;
		this.currentDispatch = 0;

		for ( let i = 0; i < this.dispatchCount; i ++ ) {

			this.computeStep( renderer );

		}

	}

}
