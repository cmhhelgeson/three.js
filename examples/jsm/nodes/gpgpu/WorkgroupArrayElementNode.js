import { addNodeClass } from '../core/Node.js';
import { nodeProxy, addNodeElement } from '../shadernode/ShaderNode.js';
import ArrayElementNode from './ArrayElementNode.js';

class WorkgroupArrayElementNode extends ArrayElementNode {

	constructor( workgroupArrayNode, indexNode ) {

		super( workgroupArrayNode, indexNode );

		this.isWorkgroupArrayElementNode = true;

	}

	set workgroupArrayNode( value ) {

		this.node = value;

	}

	get workgroupArrayNode() {

		return this.node;

	}

	generate( builder, output ) {

		let snippet;

		const isAssignContext = builder.context.assign;

		snippet = super.generate( builder );

		if ( isAssignContext !== true ) {

			const type = this.getNodeType( builder );

			snippet = builder.format( snippet, type, output );

		}

		return snippet;

	}

}

export default WorkgroupArrayElementNode;

export const workgroupElement = nodeProxy( WorkgroupArrayElementNode );

addNodeElement( 'workgroupElement', workgroupElement );

addNodeClass( 'WorkgroupArrayElementNode', WorkgroupArrayElementNode );
