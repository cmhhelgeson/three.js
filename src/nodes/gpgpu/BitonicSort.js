import { Fn, If, vec4, uint, uvec2 } from '../tsl/TSLBase.js';
import { instanceIndex, invocationLocalIndex, Loop, workgroupArray, workgroupBarrier } from '../TSL.js';

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


// Implementation of an in-place bitonic sort.
export const bitonicSort = ( {
	dataBuffer,
	sideEffectBuffers,
	workgroupSize
} ) => {

	console.log( dataBuffer );

	const localStorage = workgroupArray( 'uint', workgroupSize * 2 );

	// Swap the elements in local storage
	const localCompareAndSwap = ( idxBefore, idxAfter ) => {

		If( localStorage.element( idxAfter ).lessThan( localStorage.element( idxBefore ) ), () => {

			const temp = localStorage.element( idxBefore ).toVar();
			localStorage.element( idxBefore ).assign( localStorage.element( idxAfter ) );
			localStorage.element( idxAfter ).assign( temp );

		} );

	};

	const globalCompareAndSwap = ( idxBefore, idxAfter ) => {

		// If the later element is less than the current element
		If( currentElementsStorage.element( idxAfter ).lessThan( currentElementsStorage.element( idxBefore ) ), () => {

			tempStorage.element( idxBefore ).assign( currentElementsStorage.element( idxAfter ) );
			tempStorage.element( idxAfter ).assign( currentElementsStorage.element( idxBefore ) );

		} ).Else( () => {

			// Otherwise apply the existing values to temporary storage.
			tempStorage.element( idxBefore ).assign( currentElementsStorage.element( idxBefore ) );
			tempStorage.element( idxAfter ).assign( currentElementsStorage.element( idxAfter ) );

		} );

	};

	return Fn( () => {

		// Get ids of indices needed to populate workgroup local buffer.
		// Use .toVar() to prevent these values from being recalculated multiple times.
		// Workgroup Size: 64, Num Workgroups: 4
		// localOffset: 0 -> 128 -> 256 -> 384
		const localOffset = uint( workgroupSize ).mul( 2 ).mul( workgroupId.x ).toVar();

		const localID1 = invocationLocalIndex.mul( 2 );
		const localID2 = invocationLocalIndex.mul( 2 ).add( 1 );

		// If we will perform a local swap, then populate the local data
		If( nextAlgo.lessThanEqual( uint( StepType.DISPERSE_LOCAL ) ), () => {

			localStorage.element( localID1 ).assign( dataBuffer.element( localOffset.add( localID1 ) ) );
			localStorage.element( localID2 ).assign( dataBuffer.element( localOffset.add( localID2 ) ) );

		} );


	} )().compute( dataBuffer.value.count, [ workgroupSize ] );


};

const localStorage = workgroupArray( 'uint', 64 * 2 );

// Swap the elements in local storage
const localCompareAndSwap = ( idxBefore, idxAfter ) => {

	If( localStorage.element( idxAfter ).lessThan( localStorage.element( idxBefore ) ), () => {

		const temp = localStorage.element( idxBefore ).toVar();
		localStorage.element( idxBefore ).assign( localStorage.element( idxAfter ) );
		localStorage.element( idxAfter ).assign( temp );

	} );

};

const globalCompareAndSwap = ( idxBefore, idxAfter ) => {

	// If the later element is less than the current element
	If( currentElementsStorage.element( idxAfter ).lessThan( currentElementsStorage.element( idxBefore ) ), () => {

		tempStorage.element( idxBefore ).assign( currentElementsStorage.element( idxAfter ) );
		tempStorage.element( idxAfter ).assign( currentElementsStorage.element( idxBefore ) );

	} ).Else( () => {

		// Otherwise apply the existing values to temporary storage.
		tempStorage.element( idxBefore ).assign( currentElementsStorage.element( idxBefore ) );
		tempStorage.element( idxAfter ).assign( currentElementsStorage.element( idxAfter ) );

	} );

};

const computeInitFn = Fn( () => {

	randomizedElementsStorage.element( instanceIndex ).assign( currentElementsStorage.element( instanceIndex ) );

} );

const computeBitonicStepFn = Fn( () => {

	const nextBlockHeight = nextBlockHeightStorage.element( 0 ).toVar();
	const nextAlgo = nextAlgoStorage.element( 0 ).toVar();

	// Get ids of indices needed to populate workgroup local buffer.
	// Use .toVar() to prevent these values from being recalculated multiple times.
	const localOffset = uint( WORKGROUP_SIZE[ 0 ] ).mul( 2 ).mul( workgroupId.x ).toVar();

	const localID1 = invocationLocalIndex.mul( 2 );
	const localID2 = invocationLocalIndex.mul( 2 ).add( 1 );

	// If we will perform a local swap, then populate the local data
	If( nextAlgo.lessThanEqual( uint( StepType.DISPERSE_LOCAL ) ), () => {

		localStorage.element( localID1 ).assign( currentElementsStorage.element( localOffset.add( localID1 ) ) );
		localStorage.element( localID2 ).assign( currentElementsStorage.element( localOffset.add( localID2 ) ) );

	} );

	// Ensure that all local data has populated
	workgroupBarrier();

	// Perform a chunk of the sort in a single pass that operates entirely in workgroup local space
	If( nextAlgo.equal( uint( StepType.SWAP_LOCAL ) ), () => {

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

				const disperseIdx = getBitonicFlipIndices( invocationLocalIndex, nextBlockHeight );
				localCompareAndSwap( disperseIdx.x, disperseIdx.y );

				localBlockHeight.divAssign( 2 );

			} );

			// flipBlockHeight *= 2;
			flipBlockHeight.shiftLeftAssign( 1 );

		} );

	} ).ElseIf( nextAlgo.equal( uint( StepType.DISPERSE_LOCAL ) ), () => {

		const localBlockHeight = nextBlockHeight.toVar();

		Loop( localBlockHeight.greaterThan( 1 ), () => {

			workgroupBarrier();

			const idx = getBitonicDisperseIndices( invocationLocalIndex, nextBlockHeight );
			localCompareAndSwap( idx.x, idx.y );

			localBlockHeight.divAssign( 2 );

		} );

	} ).ElseIf( nextAlgo.equal( uint( StepType.FLIP_GLOBAL ) ), () => {

		const idx = getBitonicFlipIndices( instanceIndex, nextBlockHeight );
		globalCompareAndSwap( idx.x, idx.y );

	} ).ElseIf( nextAlgo.equal( uint( StepType.DISPERSE_GLOBAL ) ), () => {

		const idx = getBitonicDisperseIndices( instanceIndex, nextBlockHeight );
		globalCompareAndSwap( idx.x, idx.y );

	} );

	// Ensure that all invocations have swapped their own regions of data
	workgroupBarrier();

	// Populate output data with the results from our swaps
	If( nextAlgo.lessThanEqual( uint( StepType.DISPERSE_LOCAL ) ), () => {

		currentElementsStorage.element( localOffset.add( localID1 ) ).assign( localStorage.element( localID1 ) );
		currentElementsStorage.element( localOffset.add( localID2 ) ).assign( localStorage.element( localID2 ) );

	} );

	// If the previous algorithm was global, we execute an additional compute step to sync the current buffer with the output buffer.

} );

const computeSetAlgoFn = Fn( () => {

	const nextBlockHeight = nextBlockHeightStorage.element( 0 ).toVar();
	const nextAlgo = nextAlgoStorage.element( 0 );
	const highestBlockHeight = highestBlockHeightStorage.element( 0 ).toVar();

	nextBlockHeight.divAssign( 2 );

	If( nextBlockHeight.equal( 1 ), () => {

		highestBlockHeight.mulAssign( 2 );

		if ( forceGlobalSwap ) {

			If( highestBlockHeight.equal( size * 2 ), () => {

				nextAlgo.assign( StepType.NONE );
				nextBlockHeight.assign( 0 );

			} ).Else( () => {

				nextAlgo.assign( StepType.FLIP_GLOBAL );
				nextBlockHeight.assign( highestBlockHeight );

			} );

		} else {

			If( highestBlockHeight.equal( size * 2 ), () => {

				nextAlgo.assign( StepType.NONE );
				nextBlockHeight.assign( 0 );

			} ).ElseIf( highestBlockHeight.greaterThan( WORKGROUP_SIZE[ 0 ] * 2 ), () => {

				nextAlgo.assign( StepType.FLIP_GLOBAL );
				nextBlockHeight.assign( highestBlockHeight );

			} ).Else( () => {

				nextAlgo.assign( forceGlobalSwap ? StepType.FLIP_GLOBAL : StepType.FLIP_LOCAL );
				nextBlockHeight.assign( highestBlockHeight );

			} );

		}

	} ).Else( () => {

		if ( forceGlobalSwap ) {

			nextAlgo.assign( StepType.DISPERSE_GLOBAL );

		} else {

			nextAlgo.assign( nextBlockHeight.greaterThan( WORKGROUP_SIZE[ 0 ] * 2 ).select( StepType.DISPERSE_GLOBAL, StepType.DISPERSE_LOCAL ).uniformFlow() );

		}

	} );

	nextBlockHeightStorage.element( 0 ).assign( nextBlockHeight );
	highestBlockHeightStorage.element( 0 ).assign( highestBlockHeight );

} );

// TODO: Add parameters for computing a buffer larger than vec4
class BitonicSort {

	constructor( renderer, dataBuffer, options = {} ) {

		this.dataBuffer = dataBuffer;
		this.sideEffectBuffers = options.sideEffectBuffers ? options.sideEffectBuffers : [];
		this.workgroupSize = options.workgroupSize ? options.workgroupSize : 64;
		this.count = dataBuffer.value.count;

		this.bitonicSortFn = null;
		this.setAlgoFn = null;

		this.swapOpCount = this.getSwapOpCount( dataBuffer.value.count );
		this.dispatchCount = this.getDispatchCount();

		this.dispatchFn = [];

	}

	getSwapOpCount() {

		const n = Math.log2( this.count );
		return ( n * ( n + 1 ) ) / 2;

	}

	getDispatchCount() {

		if ( this.dispatches === undefined ) {

			const logElements = Math.log2( this.count );
			const logSwapSpan = Math.log2( this.workgroupSize * 2 );

			const numGlobalFlips = logElements - logSwapSpan;

			// Start with 1 for initial sort over all local elements
			let dispatches = 1;

			for ( let i = 1; i <= numGlobalFlips; i ++ ) {

				// Increment by swap's global operations and alignments
				dispatches += i * 2;
				// Increment by alignment (1 per global op)
				dispatches += i;
				// Increment by local sort
				dispatches += 1;

			}

			this.dispatches = dispatches;

		}

		return this.dispatches;

	}


	compute( renderer ) {

		let globalOps = 0;

		let maxGlobalOp = 0;

		for ( let i = 0; i < this.dispatchCount; i ++ ) {

			renderer.compute( this.bitonicSortFn );
			renderer.compute( this.blockHeightFn );

			if ( globalOps > 0 ) {

				renderer.compute( computeAlignFn );

				globalOps --;

			} else {

				maxGlobalOp += 1;
				globalOps = maxGlobalOp;

			}

		}

	}

}
