import { expression } from '../code/ExpressionNode.js';
import { addNodeElement } from '../shadernode/ShaderNode.js';

// Synchronization Built-in Functions
export const workgroupBarrier = () => expression( 'workgroupBarrier();' ).append();
export const textureBarrier = () => expression( 'textureBarrier();' ).append();
export const storageBarrier = () => expression( 'storageBarrier();' ).append();

addNodeElement( 'workgroupBarrier', workgroupBarrier );
addNodeElement( 'textureBarrier', textureBarrier );
addNodeElement( 'storageBarrier', storageBarrier );
