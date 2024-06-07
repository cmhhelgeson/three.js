import Node, {addNodeClass} from '../core/Node.js'
import { nodeImmutable } from '../shadernode/ShaderNode.js';

class ComputeBuiltinNode extends Node {

	constructor( scope, nodeType ) {

		super( nodeType );

		this.scope = scope;

		this.isComputeBuiltinNode = true;

	}

	generate( builder ) {

		const nodeType = this.getNodeType( builder );
		const scope = this.scope;

		let propertyName;

		switch (scope) {

			case ComputeBuiltinNode.SUBGROUP_SIZE:

				propertyName = builder.getSubgroupSize();
				break;

			case ComputeBuiltinNode.WORKGROUP_ID: 

				propertyName = builder.getWorkgroupId();
				break;

			case ComputeBuiltinNode.NUM_WORKGROUPS: 

				propertyName = builder.getNumWorkgroups();
				break;

			case ComputeBuiltinNode.LOCAL_ID:

				propertyName = builder.getLocalId();
				break;

			default:

				throw new Error( 'THREE.ComputeBuiltinNode: Unknown scope: ' + scope );
	
		}

		let output;

		if ( builder.shaderStage === 'compute' ) {

			output = propertyName;

		} else {

			throw new Error( 'Three.ComputeBuiltinNode: Node generated in invalid shader stage' );

		}

		return output;

	}

}

ComputeBuiltinNode.SUBGROUP_SIZE = 'subgroupSize';
ComputeBuiltinNode.WORKGROUP_ID = 'workgroupId';
ComputeBuiltinNode.LOCAL_ID = 'localId';
ComputeBuiltinNode.NUM_WORKGROUPS = 'numWorkgroups';

export default ComputeBuiltinNode;

export const subgroupSize = nodeImmutable( ComputeBuiltinNode, ComputeBuiltinNode.SUBGROUP_SIZE, 'uint' );
export const workgroupId = nodeImmutable( ComputeBuiltinNode, ComputeBuiltinNode.WORKGROUP_ID, 'uvec3' );
export const localId = nodeImmutable( ComputeBuiltinNode, ComputeBuiltinNode.LOCAL_ID, 'uvec3' );
export const numWorkgroups = nodeImmutable( ComputeBuiltinNode, ComputeBuiltinNode.NUM_WORKGROUPS, 'uvec3' );

addNodeClass( 'ComputeBuiltinNode', ComputeBuiltinNode );