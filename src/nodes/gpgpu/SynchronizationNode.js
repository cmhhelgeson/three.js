import { expression } from '../code/ExpressionNode.js';
import { addNodeElement } from '../shadernode/ShaderNode.js';

// Synchronization Built-in Functions
export const workgroupBarrier = () => expression( 'workgroupBarrier();\n' ).append();
export const textureBarrier = () => expression( 'textureBarrier();\n' ).append();
export const storageBarrier = () => expression( 'storageBarrier();\n' ).append();

addNodeElement( 'workgroupBarrier', workgroupBarrier );
addNodeElement( 'textureBarrier', textureBarrier );
addNodeElement( 'storageBarrier', storageBarrier );
