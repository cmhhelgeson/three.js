import { addNodeElement, nodeProxy } from '../shadernode/ShaderNode.js';
import { addNodeClass } from '../core/Node.js';
import TempNode from '../core/TempNode.js';

// Following specification laid out at https://github.com/gpuweb/gpuweb/blob/main/proposals/subgroups.md
class SubgroupFunctionNode extends TempNode {

	constructor( method, aNode = null, bNode = null ) {

		super();

		this.method = method;
		console.log( this.method );

		this.aNode = aNode;
		this.bNode = bNode;

	}

	getInputType( builder ) {

		const aType = this.aNode ? this.aNode.getNodeType( builder ) : null;
		const bType = this.bNode ? this.bNode.getNodeType( builder ) : null;

		const aLen = builder.isMatrix( aType ) ? 0 : builder.getTypeLength( aType );
		const bLen = builder.isMatrix( bType ) ? 0 : builder.getTypeLength( bType );

		if ( bLen > aLen ) {

			return bType;

		}

		return aType;

	}

	getNodeType( builder ) {

		const method = this.method;

		if ( method === SubgroupFunctionNode.ELECT ) {

			return 'bool';

		} else if ( method === SubgroupFunctionNode.BALLOT ) {

			return 'uvec4';

		} else {

			return this.getInputType( builder );

		}

	}

	generate( builder, output ) {

		builder.enableSubgroups();

		const method = this.method;

		const type = this.getNodeType( builder );
		const inputType = this.getInputType( builder );

		const a = this.aNode;
		const b = this.bNode;

		const params = [];

		if ( method === SubgroupFunctionNode.ELECT ) {

			console.log( builder.getMethod( method, type ) );

			return builder.format( 'quadBroadcast()', type, output );



		} else if ( method === SubgroupFunctionNode.BROADCAST || method === SubgroupFunctionNode.SHUFFLE ) {

			params.push(
				a.build( builder, inputType ),
				b.build( builder, b.getNodeType( builder ) === 'float' ? 'int' : b.getNodeType( builder ) )
			);

		} else if ( method === SubgroupFunctionNode.SHUFFLE_XOR || method === SubgroupFunctionNode.SHUFFLE_UP || method === SubgroupFunctionNode.SHUFFLE_DOWN ) {

			params.push(
				a.build( builder, inputType ),
				b.build( builder, 'uint' )
			);

		} else {

			if ( a !== null ) params.push( a.build( builder, inputType ) );
			if ( b !== null ) params.push( b.build( builder, inputType ) );

		}

		return builder.format( `${ builder.getMethod( method, type ) }( ${params.join( ', ' )} )`, type, output );

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

// 0 input

SubgroupFunctionNode.ELECT = 'subgroupElect';

// 1 input

SubgroupFunctionNode.ALL = 'subgroupAll';
SubgroupFunctionNode.ANY = 'subgroupAny';
SubgroupFunctionNode.BROADCAST = 'subgroupBroadcast';
SubgroupFunctionNode.BROADCAST_FIRST = 'subgroupBroadcastFirst';
SubgroupFunctionNode.BALLOT = 'subgroupBallot';
SubgroupFunctionNode.ADD = 'subgroupAdd';
SubgroupFunctionNode.EXCLUSIVE_ADD = 'subgroupExclusiveAdd';
SubgroupFunctionNode.MUL = 'subgroupMul';
SubgroupFunctionNode.AND = 'subgroupAnd';
SubgroupFunctionNode.OR = 'subgroupOr';
SubgroupFunctionNode.XOR = 'subgroupXor';
SubgroupFunctionNode.MIN = 'subgroupMin';
SubgroupFunctionNode.MAX = 'subgroupMax';

// 2 inputs
SubgroupFunctionNode.SHUFFLE = 'subgroupShuffle';
SubgroupFunctionNode.SHUFFLE_XOR = 'subgroupShuffleXor';
SubgroupFunctionNode.SHUFFLE_UP = 'subgroupShuffleUp';
SubgroupFunctionNode.SHUFFLE_DOWN = 'subgroupShuffleDown';

export default SubgroupFunctionNode;

// Subgroup Builti-in Functions
export const subgroupElect = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.ELECT );
export const subgroupAll = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.ALL );
export const subgroupAny = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.ANY );
export const subgroupBroadcast = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.BROADCAST );
export const subgroupBroadcastFirst = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.BROADCAST_FIRST );
export const subgroupBallot = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.BALLOT );
export const subgroupAdd = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.ADD );
export const subgroupExclusiveAdd = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.EXCLUSIVE_ADD );
export const subgroupMul = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.MUL );
export const subgroupAnd = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.AND );
export const subgroupOr = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.OR );
export const subgroupXor = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.XOR );
export const subgroupMin = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.MIN );
export const subgroupMax = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.MAX );
export const subgroupShuffle = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.SHUFFLE );
export const subgroupShuffleXor = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.SHUFFLE_XOR );
export const subgroupShuffleUp = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.SHUFFLE_UP );
export const subgroupShuffleDown = nodeProxy( SubgroupFunctionNode, SubgroupFunctionNode.SHUFFLE_DOWN );

addNodeElement( 'subgroupElect', subgroupElect );
addNodeElement( 'subgroupAll', subgroupAll );
addNodeElement( 'subgroupAny', subgroupAny );
addNodeElement( 'subgroupBroadcast', subgroupBroadcast );
addNodeElement( 'subgroupBroadcastFirst', subgroupBroadcastFirst );
addNodeElement( 'subgroupBallot', subgroupBallot );
addNodeElement( 'subgroupAdd', subgroupAdd );
addNodeElement( 'subgroupExclusiveAdd', subgroupExclusiveAdd );
addNodeElement( 'subgroupMul', subgroupMul );
addNodeElement( 'subgroupAnd', subgroupAnd );
addNodeElement( 'subgroupOr', subgroupOr );
addNodeElement( 'subgroupXor', subgroupXor );
addNodeElement( 'subgroupMin', subgroupMin );
addNodeElement( 'subgroupMax', subgroupMax );
addNodeElement( 'subgroupShuffle', subgroupShuffle );
addNodeElement( 'subgroupShuffleXor', subgroupShuffleXor );
addNodeElement( 'subgroupShuffleUp', subgroupShuffleUp );
addNodeElement( 'subgroupShuffleDown', subgroupShuffleDown );

addNodeClass( 'SubgroupFunctionNode', SubgroupFunctionNode );


