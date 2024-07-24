import { nodeObject, vec4 } from '../shadernode/ShaderNode.js';
import { output } from '../core/PropertyNode.js';
import PassNode from './PassNode.js';
import { mrt } from '../core/MRTNode.js';

class MaskPassNode extends PassNode {

	constructor( scene, camera ) {

		super( 'color', scene, camera );

		this.isMaskPassNode = true;

		this._mrt = mrt( {
			output: output,
			mask: vec4( 0.0 ) // empty as default, custom materials can set this
		} );

	}

	setup() {

		const mask = super.getTextureNode( 'mask' );
		return mask;

	}

}

export const maskPass = ( scene, camera ) => nodeObject( new MaskPassNode( scene, camera ) );

export default MaskPassNode;
