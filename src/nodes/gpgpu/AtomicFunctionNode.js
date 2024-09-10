import TempNode from '../core/TempNode.js';
import { nodeProxy } from '../tsl/TSLCore.js';

class AtomicFunctionNode extends TempNode {

	static get type() {

		return 'AtomicFunctionNode';

	}

	constructor( method, pointerNode, valueNode ) {

		super( 'uint' );

		this.method = method;

		this.pointerNode = pointerNode;
		this.valueNode = valueNode;

	}

	getInputType( builder ) {

		return this.aNode.getNodeType( builder );

	}

	getNodeType( builder ) {

		return this.getInputType( builder );

	}

	generate( builder, output ) {

		console.log( output );

		const method = this.method;

		const type = this.getNodeType( builder );
		const inputType = this.getInputType( builder );

		const a = this.aNode;
		const b = this.bNode;

		const params = [];

		params.push( `&${ a.build( builder, inputType ) }` );
		params.push( b.build( builder, inputType ) );

		builder.addLineFlowCode( `${ builder.getMethod( method, type ) }( ${params.join( ', ' )} )` );

	}

}

AtomicFunctionNode.ATOMIC_LOAD = 'atomicLoad';
AtomicFunctionNode.ATOMIC_STORE = 'atomicStore';
AtomicFunctionNode.ATOMIC_ADD = 'atomicAdd';
AtomicFunctionNode.ATOMIC_SUB = 'atomicSub';
AtomicFunctionNode.ATOMIC_MAX = 'atomicMax';
AtomicFunctionNode.ATOMIC_MIN = 'atomicMin';
AtomicFunctionNode.ATOMIC_AND = 'atomicAnd';
AtomicFunctionNode.ATOMIC_OR = 'atomicOr';
AtomicFunctionNode.ATOMIC_XOR = 'atomicXor';

export default AtomicFunctionNode;

const atomicNode = nodeProxy( AtomicFunctionNode );

export const atomicFunc = ( method, aNode, bNode ) => {

	const node = atomicNode( method, aNode, bNode );

	return node;

};

export const atomicStore = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_STORE, aNode, bNode );
export const atomicAdd = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_ADD, aNode, bNode );
export const atomicSub = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_SUB, aNode, bNode );
export const atomicMax = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_MAX, aNode, bNode );
export const atomicMin = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_MIN, aNode, bNode );
export const atomicAnd = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_AND, aNode, bNode );
export const atomicOr = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_OR, aNode, bNode );
export const atomicXor = ( aNode, bNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_XOR, aNode, bNode );
