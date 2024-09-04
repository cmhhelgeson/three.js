import TempNode from '../core/TempNode.js';
import { addMethodChaining, nodeProxy } from '../tsl/TSLCore.js';

class AtomicFunctionNode extends TempNode {

	static get type() {

		return 'AtomicFunctionNode';

	}

	constructor( method, aNode, bNode ) {

		super();

		this.method = method;

		this.aNode = aNode;
		this.bNode = bNode;

	}

	getInputType( builder ) {

		return this.aNode.getNodeType( builder );

	}

	getNodeType( builder ) {

		return this.getInputType( builder );

	}

	generate( builder ) {

		const method = this.method;

		const type = this.getNodeType( builder );
		const inputType = this.getInputType( builder );

		const a = this.aNode;
		const b = this.bNode;

		const params = [];

		params.push( `&${ a.build( builder, inputType ) }` );
		params.push( b.build( builder, inputType ) );

		return `${builder.getMethod( method, type )}( ${params.join( ', ' )} )`;

	}

	serialize( data ) {

		super.serialize( data );

		data.method = this.method;

	}

	deserialize( data ) {

		super.deserialize( data );

		this.method = data.method;

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

export const atomicLoad = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_LOAD );
export const atomicStore = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_STORE );
export const atomicAdd = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_ADD );
export const atomicSub = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_SUB );
export const atomicMax = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_MAX );
export const atomicMin = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_MIN );
export const atomicAnd = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_AND );
export const atomicOr = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_OR );
export const atomicXor = /*@__PURE__*/ nodeProxy( AtomicFunctionNode, AtomicFunctionNode.ATOMIC_XOR );


addMethodChaining( 'atomicAdd', atomicAdd );
