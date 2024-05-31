import { addNodeClass, nodeProxy } from '../Nodes.js';
import ExpressionNode, { expression } from './ExpressionNode.js';

class BarrierNode extends ExpressionNode {
	constructor( snippet = '' ) {

		super(`${snippet}Barrier()`);

		this.isBarrierNode = true;

	}

}

export default BarrierNode;

export const barrier = nodeProxy( BarrierNode );

addNodeClass( 'BarrierNode', BarrierNode );

export const workgroupBarrier = () => barrier( 'workgroup' ).append();
export const subgroupBarrier = () => barrier( 'subgroup' ).append();
export const textureBarrier = () => barrier( 'texture' ).append();
export const storageBarrier = () => barrier( 'storage' ).append(); 