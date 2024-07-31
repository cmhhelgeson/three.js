import Node, { addNodeClass } from './Node.js';
import { varying } from './VaryingNode.js';
import { nodeImmutable } from '../shadernode/ShaderNode.js';

class IndexNode extends Node {

	constructor( scope ) {

		super( 'uint' );

		this.scope = scope;

		this.isInstanceIndexNode = true;

	}

	generate( builder ) {

		const nodeType = this.getNodeType( builder );
		const scope = this.scope;

		let propertyName;

		switch ( scope ) {

			case IndexNode.VERTEX : {

				propertyName = builder.getVertexIndex();
				break;

			}

			case IndexNode.INSTANCE: {

				propertyName = builder.getInstanceIndex();
				break;

			}

			case IndexNode.DRAW: {

				propertyName = builder.getDrawIndex();
				break;

			}

			case IndexNode.SUBGROUP: {

				if ( builder.shaderStage === 'vertex' ) {

					throw new Error( 'THREE.IndexNode: Index of scope: ' + scope + ' cannot be used in the vertex stage' );

				}

				builder.enableSubgroups();

				propertyName = builder.getSubgroupIndex();

			}

			default: {

				throw new Error( 'THREE.IndexNode: Unknown scope: ' + scope );

			}

		}

		let output;

		if ( builder.shaderStage === 'vertex' || builder.shaderStage === 'compute' || scope === IndexNode.SUBGROUP ) {

			output = propertyName;

		} else {

			const nodeVarying = varying( this );

			output = nodeVarying.build( builder, nodeType );

		}

		return output;

	}

}

IndexNode.VERTEX = 'vertex';
IndexNode.INSTANCE = 'instance';
IndexNode.DRAW = 'draw';
IndexNode.SUBGROUP = 'subgroup';

export default IndexNode;

export const vertexIndex = nodeImmutable( IndexNode, IndexNode.VERTEX );
export const instanceIndex = nodeImmutable( IndexNode, IndexNode.INSTANCE );
export const drawIndex = nodeImmutable( IndexNode, IndexNode.DRAW );
export const subgroupIndex = nodeImmutable( IndexNode, IndexNode.SUBGROUP );

addNodeClass( 'IndexNode', IndexNode );
