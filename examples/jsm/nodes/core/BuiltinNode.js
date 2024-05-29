import Node, { addNodeClass } from './Node.js';
import { varying } from './VaryingNode.js';
import { nodeImmutable } from '../shadernode/ShaderNode.js';

// @TODO: Recategorize current catch all node for ancillary WGSL builtins
class BuiltinNode extends Node {

	constructor( scope, nodeType ) {

		super( nodeType );

		this.scope = scope;

		this.isBuiltinNode = true;

	}

	generate( builder ) {

		const nodeType = this.getNodeType( builder );
		const scope = this.scope;

		let propertyName;

		if ( scope === BuiltinNode.SUBGROUP_SIZE ) {

			propertyName = builder.getSubgroupSize();

		} else if ( scope === BuiltinNode.WORKGROUP_ID ) {

			propertyName = builder.getWorkgroupId();
			
		} else {

			throw new Error( 'THREE.BuiltinNode: Unknown scope: ' + scope );

		}

		let output;

		if ( builder.shaderStage === 'vertex' || builder.shaderStage === 'compute' ) {

			output = propertyName;

		} else {

			const nodeVarying = varying( this );

			output = nodeVarying.build( builder, nodeType );

		}

		return output;

	}

}

BuiltinNode.SUBGROUP_SIZE = 'subgroupSize';
BuiltinNode.WORKGROUP_ID = 'workgroupId';

export default BuiltinNode;

export const subgroupSize = nodeImmutable( BuiltinNode, BuiltinNode.SUBGROUP_SIZE, 'uint' );
export const workgroupId = nodeImmutable( BuiltinNode, BuiltinNode.WORKGROUP_ID, 'uvec3' );

addNodeClass( 'BuiltinNode', BuiltinNode );