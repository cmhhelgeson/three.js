import Node, { addNodeClass } from './Node.js';
import { nodeImmutable, nodeObject } from '../shadernode/ShaderNode.js';

class WorkgroupLocalNode extends Node {

	constructor( nodeType, name = null, size = 64) {

		super( nodeType );

		this.name = name;
		this.size = size;

		this.isWorkgroupLocalNode = true;

	}

	getHash( builder ) {

		return this.name || super.getHash( builder );

	}

	generate( builder ) {

		return builder.getLocal( this );

	}

}

export default WorkgroupLocalNode;

export const workgroupLocal = nodeProxy( WorkgroupLocalNode );

addNodeElement( 'workgroupLocal', workgroupLocal );

addNodeClass( 'WorkgroupLocalNode', WorkgroupLocalNode );