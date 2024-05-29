import Node, { addNodeClass } from './Node.js';
import { varying } from './VaryingNode.js';
import { nodeImmutable } from '../shadernode/ShaderNode.js';

// @TODO: Recategorize current catch all node for ancillary WGSL builtins
class BarrierNode extends Node {

	constructor( scope ) {

		super( null );

		this.scope = scope;

		this.isBarrierNode = true;

	}

	generate( builder ) {

		let snippet;

		snippet = builder.generateControlBarrier( this.scope );
		builder.addLineFlowCode( snippet );

		return snippet;

	}

}

export default BarrierNode;

addNodeClass( 'BarrierNode', BarrierNode );