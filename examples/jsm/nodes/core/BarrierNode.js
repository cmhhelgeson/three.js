import { expression } from '../code/ExpressionNode.js';

export const workgroupBarrier = () => expression( 'workgroupBarrier()' ).append();
export const subgroupBarrier = () => expression( 'subgroupBarrier()' ).append();
export const textureBarrier = () => expression( 'textureBarrier()' ).append();
export const storageBarrier = () => expression( 'storageBarrier()' ).append(); 