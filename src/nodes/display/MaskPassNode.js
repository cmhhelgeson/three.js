import { nodeObject, vec4 } from '../shadernode/ShaderNode.js';
import { output } from '../core/PropertyNode.js';
import PassNode from './PassNode.js';
import { mrt } from '../core/MRTNode.js';
import { Color } from '../../math/Color.js';
import { viewportBottomLeft } from './ViewportNode.js';
import { texture } from '../accessors/TextureNode.js';
import { Vector2 } from '../../math/Vector2.js';

const _size = /*@__PURE__*/ new Vector2();

class MaskPassNode extends PassNode {

	constructor( baseTextureNode, scene, camera, innerTextureNode ) {

		super( 'color', scene, camera );

		this.baseTextureNode = baseTextureNode;
		this.innerTextureNode = innerTextureNode;

		this.isMaskPassNode = true;

		this._oldClearColor = new Color();

		this._mrt = mrt( {
			output: output,
			mask: vec4( 1.0, 0.0, 0.0, 1.0 ),
			alpha: output.a,
		} );

	}

	updateBefore( frame ) {

		const { renderer } = frame;
		const { scene, camera } = this;

		// Store old values
		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();
		renderer.getClearColor( this._oldClearColor );
		this.oldClearAlpha = renderer.getClearAlpha();

		// Setup
		this._pixelRatio = renderer.getPixelRatio();
		const size = renderer.getSize( _size );
		this.setSize( size.width, size.height );

		this._cameraNear.value = camera.near;
		this._cameraFar.value = camera.far;

		renderer.setClearColor( 0x000000 );
		renderer.setRenderTarget( this.renderTarget );
		renderer.setMRT( this._mrt );

		renderer.render( scene, camera );

		// Restore
		renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

	}

	setup() {

		const mask = super.getTextureNode( 'mask' );
		const alpha = super.getTextureNode( 'alpha' );

		return super.getTextureNode( 'output' );

	}

}

export const applyMask = ( baseTextureNode, scene, camera, inputTextureNode ) => nodeObject( new MaskPassNode( baseTextureNode, scene, camera, inputTextureNode ) );

export default MaskPassNode;
