import Node, { addNodeClass } from './Node.js';
import { nodeImmutable, nodeObject } from '../shadernode/ShaderNode.js';
import Node, { addNodeClass } from './Node.js';
import { nodeImmutable, nodeObject } from '../shadernode/ShaderNode.js';
import { workgroupElement } from './WorkgroupArrayElementNode.js';

class WorkgroupArrayNode extends Node {

	constructor( name, nodeType, size = 64) {

		super( nodeType );

		this.name = name;
		this.size = size;

		this.isWorkgroupLocalNode = true;

	}

	getHash( builder ) {

		return this.name || super.getHash( builder );

	}

	element( indexNode ) {

		return workgroupElement( this, indexNode );

	}

	generate( builder ) {

		builder.getWorkgroupLocal( this.name, builder.getType(this.nodeType), this.size );

	}

}

export default WorkgroupArrayNode;

export const workgroupLocal = nodeProxy( WorkgroupArrayNode );

addNodeElement( 'workgroupLocal', workgroupLocal );

addNodeClass( 'WorkgroupLocalNode', WorkgroupArrayNode );