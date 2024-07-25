import TempNode from '../core/TempNode.js';
import { nodeObject, addNodeElement, tslFn, vec3, vec4, float } from '../shadernode/ShaderNode.js';
import { NodeUpdateType } from '../core/constants.js';
import { uv } from '../accessors/UVNode.js';
import { min } from '../math/MathNode.js';
import { dot } from '../math/MathNode.js';

import { property } from '../core/PropertyNode.js';

export const sepia = /*@__PURE__*/ tslFn( ( { color } ) => {

	const c = property( 'vec3', 'c' ).assign( color.rgb );

	color.r = dot( c, vec3( 0.393, 0.769, 0.189 ) );
	color.g = dot( c, vec3( 0.349, 0.686, 0.168 ) );
	color.b = dot( c, vec3( 0.272, 0.534, float( 1.0 ).sub( 0.869 ) ) );

	return vec4( min( vec3( 1.0 ), color.rgb ), 1.0 );

} );

addNodeElement( 'sepia', sepia );
