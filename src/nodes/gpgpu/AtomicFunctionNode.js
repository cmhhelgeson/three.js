import TempNode from '../core/TempNode.js';
import { nodeProxy } from '../tsl/TSLCore.js';

class AtomicFunctionNode extends TempNode {

	static get type() {

		return 'AtomicFunctionNode';

	}

	constructor( method, aNode, bNode, assignToNode = null ) {

		super( 'uint' );

		this.method = method;

		this.aNode = aNode;
		this.bNode = bNode;
		this.assignToNode = assignToNode;

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
		console.log( type );
		const inputType = this.getInputType( builder );

		const a = this.aNode;
		const b = this.bNode;
		const assignTo = this.assignToNode;

		const params = [];

		params.push( `&${ a.build( builder, inputType ) }` );
		params.push( b.build( builder, inputType ) );

		if ( assignTo === null ) {

			builder.addLineFlowCode( `${ builder.getMethod( method, type ) }( ${params.join( ', ' )} )` );

		} else {

			return builder.format( `${ builder.getMethod( method, type ) }( ${params.join( ', ' )} )`, type, output );

		}

	}

}

// 2 input

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

export const atomicFunc = ( method, aNode, bNode, assignToNode = null ) => {

	const node = atomicNode( method, aNode, bNode, assignToNode );

	if ( assignToNode === null ) {

		node.append();

	}

	return node;

};

export const atomicStore = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_STORE, aNode, bNode, assignToNode );
export const atomicAdd = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_ADD, aNode, bNode, assignToNode );
export const atomicSub = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_SUB, aNode, bNode, assignToNode );
export const atomicMax = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_MAX, aNode, bNode, assignToNode );
export const atomicMin = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_MIN, aNode, bNode, assignToNode );
export const atomicAnd = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_AND, aNode, bNode, assignToNode );
export const atomicOr = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_OR, aNode, bNode, assignToNode );
export const atomicXor = ( aNode, bNode, assignToNode ) => atomicFunc( AtomicFunctionNode.ATOMIC_XOR, aNode, bNode, assignToNode );
