import TempNode from '../core/TempNode.js';
import TextureNode, { texture, textureLoad } from '../accessors/TextureNode.js';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, nodeObject, tslFn, vec2, vec3, vec4, float, If } from '../shadernode/ShaderNode.js';
import QuadMesh from '../../renderers/common/QuadMesh.js';
import { RenderTarget } from '../../core/RenderTarget.js';
import { Color } from '../../math/Color.js';
import PassNode, { passTexture } from './PassNode.js';
import { DepthTexture } from '../../textures/DepthTexture.js';
import { NodeUpdateType } from '../core/constants.js';
import { perspectiveDepthToViewZ } from './ViewportDepthNode.js';
import { addNodeClass } from '../core/Node.js';

import { uniform } from '../core/UniformNode.js';
import { Vector2 } from '../../math/Vector2.js';
import { Matrix4 } from '../../math/Matrix4.js';

const _prepareMaskQuad = new QuadMesh();
const _size = new Vector2();

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

const OUTLINE_PASS_NODE_ID = 'OutlinePassNode';
const OUTLINE_NODE_ID = 'OutlineNode';

class OutlineNode extends TempNode {

	constructor( nsColor, nsDepth, sColor, sDepth, uniformObject ) {

		super();

		this.visibleEdgeColor = uniformObject.visibleEdgeColor || vec3( 1, 1, 1 );
		this.hiddenEdgeColor = uniformObject.hiddenEdgeColor || vec3( 0.1, 0.04, 0.02 );
		this.edgeGlow = uniformObject.edgeGlow || 0.0;
		this.usePatternTexture = uniformObject.usePatternTexture || 0;
		this.edgeThickness = uniformObject.edgeThickness || 1.0;
		this.edgeStrength = uniformObject.edgeStrength || 3.0;
		this.downSampleRatio = uniformObject.downSampleRatio || 2;
		this.pulsePeriod = uniformObject.pulsePeriod || 0;

		// TODO: Determine whether this is needed
		this._textureMatrix = uniform( new Matrix4() );

		// Render targets
		this._nonSelectedRT = this.createOutlinePassNodeTarget( 'nonSelectedDepth' );
		this._selectedRT = this.createOutlinePassNodeTarget( 'selectedDepth' );
		this._prepareMaskRT = this.createOutlinePassNodeTarget( 'prepareMask', false );

		// Revert render state objects
		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

		this._passNonSelectedDepthNode = passTexture( this, this._nonSelectedRT.depthTexture );
		this._passSelectedDepthNode = passTexture( this, this._selectedRT.depthTexture );
		this._passNonSelectedColorNode = passTexture( this, this._nonSelectedRT.texture );
		this._passSelectedColorNode = passTexture( this, this._selectedRT.texture );

		// Texture Nodes
		this.nsColorNode = nsColor;
		this.sColorNode = sColor;
		this.nsDepthNode = nsDepth;
		this.sDepthNode = sDepth;

		// External uniforms
		this.visibleEdgeColor = uniformObject.visibleEdgeColor || vec3( 1, 1, 1 );
		this.hiddenEdgeColor = uniformObject.hiddenEdgeColor || vec3( 0.1, 0.04, 0.02 );
		this.edgeGlow = uniformObject.edgeGlow || 0.0;
		this.usePatternTexture = uniformObject.usePatternTexture || 0;
		this.edgeThickness = uniformObject.edgeThickness || 1.0;
		this.edgeStrength = uniformObject.edgeStrength || 3.0;
		this.downSampleRatio = uniformObject.downSampleRatio || 2;
		this.pulsePeriod = uniformObject.pulsePeriod || 0;

		// Internal uniforms ( Global )
		this._cameraNear = uniformObject.cameraNear;
		this._cameraFar = uniformObject.cameraFar;

		// Internal uniforms ( per Output Pass )
		this._invSize = uniform( vec2( 0.5, 0.5 ) );

		// Interal uniforms ( per Output Pass Step )
		this._kernelRadius = uniform( 1.0 );
		this._texSize = uniform( new Vector2() );
		this._blurDirection = uniform( new Vector2() );

		this._passTextures = {};

		// Render Targets
		this._prepareMaskRT = this.createOutlineNodeTarget( 'prepareMask' );
		this._maskDownSampleRT = this.createOutlineNodeTarget( 'maskDownSamplePass' );
		this._edge1RT = this.createOutlineNodeTarget( 'edge1' );
		this._blur1RT = this.createOutlineNodeTarget( 'blurOne' );
		this._edge2RT = this.createOutlineNodeTarget( 'edgeTwo' );
		this._blur2RT = this.createOutlineNodeTarget( 'blurTwo' );

		this._passPrepareMaskTextureNode = passTexture( this, this._prepareMaskRT.texture );

		this.updateBeforeType = NodeUpdateType.RENDER;

	}

	createOutlineNodeTarget( name ) {

		const rt = new RenderTarget();
		rt.texture.name = `${OUTLINE_NODE_ID}.${name}`;

		return rt;

	}

	updateBefore( frame ) {

		const { renderer } = frame;

		const sTextureNode = this.sColorNode;
		const map = sTextureNode.value;

		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();
		const currentTexture = sTextureNode.value;

		_prepareMaskQuad.material = this._prepareMaskMaterial;

		this.setSize( map.image.width, map.image.height );
		const textureType = map.type;
		this._prepareMaskRT.texture.type = textureType;


		// clear

		renderer.setMRT( null );

		// horizontal

		renderer.setRenderTarget( this._prepareMaskRT );
		_prepareMaskQuad.render( renderer );

		// restore

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

		sTextureNode.value = currentTexture;

	}

	setSize( width, height ) {

		this._prepareMaskRT.setSize( width, height );

		let resx = Math.round( width / this.downSampleRatio );
		let resy = Math.round( height / this.downSampleRatio );
		this._maskDownSampleRT.setSize( resx, resy );
		this._blur1RT.setSize( resx, resy );
		this._edge1RT.setSize( resx, resy );
		this._texSize.value.set( resx, resy );

		resx = Math.round( resx / 2 );
		resy = Math.round( resy / 2 );

		this._blur2RT.setSize( resx, resy );
		this._edge2RT.setSize( resx, resy );

	}

	dispose() {

		this._prepareMaskRT.dispose();
		this._maskDownSampleRT.dispose();
		this._blur1RT.dispose();
		this._blur2RT.dispose();
		this._edge1RT.dispose();
		this._edge2RT.dispose();

	}

	setup( builder ) {

		const nsColorNode = this.nsColorNode;
		const sColorNode = this.sColorNode;
		const nsDepthNode = this.nsDepthNode;
		const sDepthNode = this.sDepthNode;

		const prepareMask = tslFn( () => {

			const nonSelectedViewZ = perspectiveDepthToViewZ( nsDepthNode, this._cameraNear, this._cameraFar );
			const selectedViewZ = perspectiveDepthToViewZ( sDepthNode, this._cameraNear, this._cameraFar );
			const depthTest = selectedViewZ.greaterThan( nonSelectedViewZ ).cond( 1.0, 0.0 );
			return vec4( 0.0, depthTest, 0.0, 1.0 );

		} );

		this._prepareMaskMaterial = this._prepareMaskMaterial || builder.createNodeMaterial();
		this._prepareMaskMaterial.fragmentNode = prepareMask().context( builder.getSharedContext() );
		this._prepareMaskMaterial.needsUpdate = true;

		return this._passPrepareMaskTextureNode;

	}

}

export const outline = ( nsColor, nsDepth, sColor, sDepth, uniformObject ) => nodeObject( new OutlineNode( nsColor, nsDepth, sColor, sDepth, uniformObject ) );
addNodeElement( 'outline', outline );
