import TempNode from '../core/TempNode.js';
import { addNodeClass } from '../core/Node.js';
import { addNodeElement, nodeProxy, tslFn, vec3, vec4 } from '../shadernode/ShaderNode.js';
import { mix, pow } from '../math/MathNode.js';
import { uv } from '../accessors/UVNode.js';
import { lessThanEqual } from '../math/OperatorNode.js';

class GammaCorrectionNode extends TempNode {

	constructor( textureNode ) {

		super();

		this.textureNode = textureNode;

	}

	setup() {

		const { textureNode } = this;
		const uvNode = textureNode.uvNode || uv();

		const sampleTexture = () => textureNode.uv( uvNode );

		const gammaCorrection = tslFn( () => {

			const tex = sampleTexture();

			return vec4( mix( pow( tex.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), tex.rgb * 12.92, vec3( lessThanEqual( tex.rgb, vec3( 0.0031308 ) ) ) ), tex.a );

		} );

		const outputNode = gammaCorrection();
		return outputNode;

	}

}

export default GammaCorrectionNode;

export const gammaCorrection = nodeProxy( GammaCorrectionNode );

addNodeElement( 'gammaCorrection', gammaCorrection );

addNodeClass( 'GammaCorrectionNode', GammaCorrectionNode );
