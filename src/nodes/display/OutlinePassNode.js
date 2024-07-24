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

class OutlinePassNode extends PassNode {

	constructor( scene, camera, resolution, selectedObjects, uniformObject ) {

		super( 'color', scene, camera );

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

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

		this.updateBeforeType = NodeUpdateType.RENDER;

	}

	createOutlinePassNodeTarget( name, depthWrite = true ) {

		const rt = new RenderTarget();
		rt.texture.name = `${OUTLINE_PASS_NODE_ID}.${name}_color`;
		this._textures[ rt.texture.name ] = rt.texture;

		if ( depthWrite ) {

			const dt = new DepthTexture();
			dt.name = `${OUTLINE_PASS_NODE_ID}.${name}_depth`;
			dt.isRenderTargetTexture = true;
			rt.depthTexture = dt;
			this._textures[ rt.depthTexture.name ] = rt.depthTexture;

		}

		return rt;

	}

	changeVisibilityOfSelectedObjects( bVisible ) {

		const cache = this._visibilityCache;

		function gatherSelectedMeshesCallBack( object ) {

			if ( object.isMesh ) {

				if ( bVisible === true ) {

					object.visible = cache.get( object );

				} else {

					cache.set( object, object.visible );
					object.visible = bVisible;

				}

			}

		}

		for ( let i = 0; i < this.selectedObjects.length; i ++ ) {

			const selectedObject = this.selectedObjects[ i ];
			selectedObject.traverse( gatherSelectedMeshesCallBack );

		}

	}

	changeVisibilityOfNonSelectedObjects( bVisible ) {

		const cache = this._visibilityCache;
		const selectedMeshes = [];

		function gatherSelectedMeshesCallBack( object ) {

			if ( object.isMesh ) selectedMeshes.push( object );

		}

		for ( let i = 0; i < this.selectedObjects.length; i ++ ) {

			const selectedObject = this.selectedObjects[ i ];
			selectedObject.traverse( gatherSelectedMeshesCallBack );

		}

		function VisibilityChangeCallBack( object ) {

			if ( object.isMesh || object.isSprite ) {

				// only meshes and sprites are supported by OutlinePass

				let bFound = false;

				for ( let i = 0; i < selectedMeshes.length; i ++ ) {

					const selectedObjectId = selectedMeshes[ i ].id;

					if ( selectedObjectId === object.id ) {

						bFound = true;
						break;

					}

				}

				if ( bFound === false ) {

					const visibility = object.visible;

					if ( bVisible === false || cache.get( object ) === true ) {

						object.visible = bVisible;

					}

					cache.set( object, visibility );

				}

			} else if ( object.isPoints || object.isLine ) {

				// the visibilty of points and lines is always set to false in order to
				// not affect the outline computation

				if ( bVisible === true ) {

					object.visible = cache.get( object ); // restore

				} else {

					cache.set( object, object.visible );
					object.visible = bVisible;

				}

			}

		}

		this.scene.traverse( VisibilityChangeCallBack );

	}

	// Create matrix that transforms world positions to texture coordinates
	updateTextureMatrix() {

		// Unlike the WebGL OutlinePass, NDC z-coordinates are already scaled to a [0, 1] range,
		// and thus are retained in the transformation from NDC-coordinates to texture coordinates.
		this._textureMatrix.value.set(
			0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 1.0, 0.0,
			0.0, 0.0, 0.0, 1.0
		);
		this._textureMatrix.value.multiply( this.camera.projectionMatrix );
		this._textureMatrix.value.multiply( this.camera.matrixWorldInverse );

	}

	updateBefore( frame ) {

		// Necessary render setup before each pass
		// Typical PassNode setup

		const { renderer } = frame;
		const { scene, camera } = this;

		this._pixelRatio = renderer.getPixelRatio();

		const size = renderer.getSize( _size );

		this.setSize( size.width, size.height );

		const currentRenderTarget = renderer.getRenderTarget();
		const currentMRT = renderer.getMRT();

		this._cameraNear.value = camera.near;
		this._cameraFar.value = camera.far;

		// Store old clear values

		renderer.getClearColor( this._oldClearColor );
		this.oldClearAlpha = renderer.getClearAlpha();
		const oldAutoClear = renderer.autoClear;

		// Modify clear values

		// renderer.autoClear = false;
		renderer.setClearColor( 0xffffff, 1 );

		// RENDER PASSES

		// 1. Draw Non Selected objects in the depth buffer
		this.changeVisibilityOfSelectedObjects( false );

		renderer.setRenderTarget( this._nonSelectedRT );
		renderer.setMRT( null );
		renderer.render( scene, camera );

		// Make selected objects visible
		this.changeVisibilityOfSelectedObjects( true );
		this._visibilityCache.clear();

		// 2. Draw selected objects in the depth buffer
		this.changeVisibilityOfNonSelectedObjects( false );

		renderer.setRenderTarget( this._selectedRT );
		renderer.render( scene, camera );

		// Make non selected objects visible, revert scene override material and background
		this.changeVisibilityOfNonSelectedObjects( true );
		this._visibilityCache.clear();

		// Pass of rest of rendering duties to OutlineNode, but for now, restore render state

		// Reset extant render state
		renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
		renderer.autoClear = oldAutoClear;

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;

		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;

		this._nonSelectedRT.setSize( effectiveWidth, effectiveHeight );
		this._selectedRT.setSize( effectiveWidth, effectiveHeight );

	}

	dispose() {

		this._nonSelectedRT.dispose();
		this._selectedRT.dispose();

	}

	setup( builder ) {

		return outline( this._passNonSelectedColor, this._passNonSelectedDepthNode, this._passSelectedColorNode, this._passSelectedDepthNode, {
			visibleEdgeColor: this.visibleEdgeColor,
			hiddenEdgeColor: this.hiddenEdgeColor,
			edgeGlow: this.edgeGlow,
			usePatternTexture: this.usePatternTexture,
			edgeThickness: this.edgeThickness,
			edgeStrength: this.edgeStrength,
			downSampleRatio: this.downSampleRatio,
			pulsePeriod: this.pulsePeriod,
			cameraNear: this._cameraNear,
			cameraFar: this._cameraFar
		} );

	}

}

export const outlinePass = ( scene, camera, resolution, selectedObjects, uniformObject ) => nodeObject( new OutlinePassNode( scene, camera, resolution, selectedObjects, uniformObject ) );

addNodeElement( 'outlinePass', outlinePass );

export default OutlinePassNode;

addNodeClass( 'OutlinePassNode', OutlinePassNode );
