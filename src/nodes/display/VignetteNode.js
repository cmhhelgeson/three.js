import TempNode from '../core/TempNode.js';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, tslFn, nodeProxy, vec4, vec2, vec3, float } from '../shadernode/ShaderNode.js';
import { dot, mix } from '../math/MathNode.js';

class VignetteNode extends TempNode {

	constructor( textureNode, offset = 1.0, darkness = 1.0 ) {

		super();

		this.textureNode = textureNode;
		this.offset = offset;
		this.darkness = darkness;

	}

	setup() {

		const { textureNode, offset, darkness } = this;

		const uvNode = textureNode.uv || uv();
		const sampleTexture = () => textureNode.uv( uvNode );

		const vignette = tslFn( () => {

			const texel = sampleTexture();
			const offsetUV = uvNode.sub( vec2( 0.5 ) ).mul( vec2( offset ) );
			return vec4( mix( texel.rgb, vec3( float( 1.0 ).sub( darkness ) ), dot( offsetUV, offsetUV ) ), texel.a );

		} );

		const outputNode = vignette();

		return outputNode;

	}

}

export const vignette = nodeProxy( VignetteNode );

addNodeElement( 'vignette', vignette );

export default VignetteNode;
