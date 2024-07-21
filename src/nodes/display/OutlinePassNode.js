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
import { linearDepth, perspectiveDepthToViewZ } from './ViewportDepthNode.js';
import { varying } from '../core/VaryingNode.js';
import { varyingProperty } from '../core/PropertyNode.js';
import { modelWorldMatrix, modelViewPosition, modelViewMatrix } from '../accessors/ModelNode.js';
import { cameraProjectionMatrix } from '../accessors/CameraNode.js';
import { positionLocal, positionGeometry } from '../accessors/PositionNode.js';
import { modelViewProjection } from '../accessors/ModelViewProjectionNode.js';
import { negate } from '../math/MathNode.js';
import { MeshBasicNodeMaterial } from '../materials/Materials.js';
import { addNodeClass } from '../core/Node.js';

import { uniform } from '../core/UniformNode.js';
import { Vector2 } from '../../math/Vector2.js';
import { Matrix4 } from '../../math/Matrix4.js';

const _quadMesh = new QuadMesh();
const _currentClearColor = new Color();
const _debugQuadMesh = new QuadMesh();
const _size = new Vector2();

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

const NODE_ID = 'OutlinePassNode';

class OutlinePassNode extends PassNode {

	constructor( scene, camera, resolution, selectedObjects, uniformObject ) {

		super( 'color', scene, camera );

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

		this.updateBeforeType = NodeUpdateType.RENDER;

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

		// Materials
		this._prepareMaskMaterial = null;

		// User-adjusted uniforms

		this.visibleEdgeColor = uniformObject.visibleEdgeColor || vec3( 1, 1, 1 );
		this.hiddenEdgeColor = uniformObject.hiddenEdgeColor || vec3( 0.1, 0.04, 0.02 );
		this.edgeGlow = uniformObject.edgeGlow || 0.0;
		this.usePatternTexture = uniformObject.usePatternTexture || 0;
		this.edgeThickness = uniformObject.edgeThickness || 1.0;
		this.edgeStrength = uniformObject.edgeStrength || 3.0;
		this.downSampleRatio = uniformObject.downSampleRatio || 2;
		this.pulsePeriod = uniformObject.pulsePeriod || 0;

		// Internal uniforms ( per Output Pass )

		this._invSize = uniform( vec2( 0.5, 0.5 ) );

		// Interal uniforms ( per Output Pass Step )

		this._kernelRadius = uniform( 1.0 );
		this._texSize = uniform( new Vector2() );
		this._blurDirection = uniform( new Vector2() );
		this._textureMatrix = uniform( new Matrix4() );

		// Render targets
		this._nonSelectedRT = this.createOutlinePassTarget( 'nonSelectedDepth' );
		this._prepareMaskRT = this.createOutlinePassTarget( 'prepareMask' );
		this._maskDownSampleRT = this.createOutlinePassTarget( 'maskDownSamplePass' );
		this._edge1RT = this.createOutlinePassTarget( 'edge1' );
		this._blur1RT = this.createOutlinePassTarget( 'blurOne' );
		this._edge2RT = this.createOutlinePassTarget( 'edgeTwo' );
		this._blur2RT = this.createOutlinePassTarget( 'blurTwo' );

		// Revert render state objects
		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

		// Shader setup vars
		this.textureNode = new TextureNode();
		this.depthTextureNode = new TextureNode();

		this._returnTexture = passTexture( this, this._nonSelectedRT.texture );


	}

	createOutlinePassTarget( name ) {

		const rt = new RenderTarget();
		rt.texture.name = `${NODE_ID}.${name}_color`;
		this._textures[ rt.texture.name ] = rt.texture;

		const dt = new DepthTexture();
		dt.name = `${NODE_ID}.${name}_depth`;
		dt.isRenderTargetTexture = true;
		rt.depthTexture = dt;
		this._textures[ rt.depthTexture.name ] = rt.depthTexture;

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

		const textureNode = this.textureNode;
		const currentTexture = textureNode.value;
		const depthTextureNode = this.depthTextureNode;
		const currentDepthTexture = depthTextureNode.value;
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

		// RENDER PASSES ( use this.renderTarget as debug texture )

		// 1. Draw Non Selected objects in the depth buffer
		this.changeVisibilityOfSelectedObjects( false );

		renderer.setRenderTarget( this._nonSelectedRT );
		renderer.setMRT( null );
		renderer.render( scene, camera );

		// 2. Draw selected objects in the depth buffer

		// Make selected objects visible
		this.changeVisibilityOfSelectedObjects( true );
		this._visibilityCache.clear();

		// Update Texture Matrix for Depth compare
		this.updateTextureMatrix();

		// Apply prepare mask material to scene
		const oldSceneOverrideMaterial = this.scene.overrideMaterial;
		this.scene.overrideMaterial = this._prepareMaskMaterial;

		// Make non selected objects invisible, and draw only the selected objects, by comparing the depth buffer of non selected objects
		this.changeVisibilityOfNonSelectedObjects( false );
		textureNode.value = this._nonSelectedRT.value;
		depthTextureNode.value = this._nonSelectedRT.depthTexture.value;
		renderer.setRenderTarget( this._prepareMaskRT );
		renderer.render( scene, camera );

		// Make non selected objects visible, revert scene override material and background
		this.changeVisibilityOfNonSelectedObjects( true );
		this._visibilityCache.clear();

		this.scene.overrideMaterial = oldSceneOverrideMaterial;

		// Reset extant render state
		renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
		renderer.autoClear = oldAutoClear;

		textureNode.value = currentTexture;
		depthTextureNode.value = currentDepthTexture;

		renderer.setRenderTarget( currentRenderTarget );
		renderer.setMRT( currentMRT );

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;

		const effectiveWidth = this._width * this._pixelRatio;
		const effectiveHeight = this._height * this._pixelRatio;

		this.renderTarget.setSize( effectiveWidth, effectiveHeight );
		this._nonSelectedRT.setSize( effectiveWidth, effectiveHeight );
		this._prepareMaskRT.setSize( effectiveWidth, effectiveHeight );

		let resx = Math.round( effectiveWidth / this.downSampleRatio );
		let resy = Math.round( effectiveHeight / this.downSampleRatio );
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

		this._blur1RT.dispose();
		this._blur2RT.dispose();
		this._edge1RT.dispose();
		this._edge2RT.dispose();
		this._maskDownSampleRT.dispose();
		this._prepareMaskRT.dispose();
		this._nonSelectedRT.dispose();

	}

	setup( builder ) {

		//const { textureNode, depthTextureNode } = this;
		//console.log( depthTextureNode );

		this._prepareMaskMaterial = this._prepareMaskMaterial || new MeshBasicNodeMaterial();

		const vTexturePos = varyingProperty( 'vec4', 'vTexturePos' );

		const prepareMaskVertexTSL = tslFn( () => {

			vTexturePos.assign( this._textureMatrix.mul( positionLocal ) );

			return modelViewProjection;

		} );

		//const nonSelectedDepthNode = super.getTextureNode( this._nonSelectedRT.depthTexture.name );

		const prepareMaskFragmentTSL = tslFn( () => {

			return vec4( 0.0, 1.0, 0.0, 1.0 );

			const projCoord = vTexturePos.xy.div( vTexturePos.z );

			const depth = depthTextureNode.uv( projCoord );

			// TODO: Check if orthographic depth
			const nonSelectedViewZ = perspectiveDepthToViewZ( depth, this._cameraNear, this._cameraFar );
			const depthTest = negate( modelViewPosition.z ).greaterThan( nonSelectedViewZ ).cond( 1.0, 0.0 );
			return vec4( 0.0, depthTest, 0.0, 1.0 );

		} );

		this._prepareMaskMaterial.vertexNode = prepareMaskVertexTSL().context( builder.getSharedContext() );
		this._prepareMaskMaterial.colorNode = prepareMaskFragmentTSL().context( builder.getSharedContext() );
		this._prepareMaskMaterial.needsUpdate = true;

		//const properties = builder.getNodeProperties( this );
		//properties.textureNode = this.textureNode;
		//properties.depthTextureNode = this.depthTextureNode;

		return super.getTextureNode( this._prepareMaskRT.texture.name );

	}

}

export const outlinePass = ( scene, camera, resolution, selectedObjects, uniformObject ) => nodeObject( new OutlinePassNode( scene, camera, resolution, selectedObjects, uniformObject ) );

addNodeElement( 'outlinePass', outlinePass );

export default OutlinePassNode;

addNodeClass( 'OutlinePassNode', OutlinePassNode );
