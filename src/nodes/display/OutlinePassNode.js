import TempNode from '../core/TempNode.js';
import { texture, textureLoad } from '../accessors/TextureNode.js';
import { uv } from '../accessors/UVNode.js';
import { addNodeElement, nodeObject, tslFn, vec2, vec3, vec4, float, If } from '../shadernode/ShaderNode.js';
import QuadMesh from '../../renderers/common/QuadMesh.js';
import { RenderTarget } from '../../core/RenderTarget.js';
import { Color } from '../../math/Color.js';
import PassNode, { passTexture } from './PassNode.js';
import { DepthTexture } from '../../textures/DepthTexture.js';
import { NodeUpdateType } from '../core/constants.js';
import { linearDepth } from './ViewportDepthNode.js';
import { varying } from '../core/VaryingNode.js';
import { modelWorldMatrix, modelViewPosition } from '../accessors/ModelNode.js';
IMPORT { model}

import { FloatType } from '../../constants.js';
import { uniform } from '../core/UniformNode.js';
import { Vector2 } from '../../math/Vector2.js';
import { Matrix4 } from '../../math/Matrix4.js';
import { positionLocal, varyingProperty } from '../Nodes.js';

const _quadMesh = new QuadMesh();
const _currentClearColor = new Color();
const _debugQuadMesh = new QuadMesh();
const _size = new Vector2();

const MAX_EDGE_THICKNESS = 4;
const MAX_EDGE_GLOW = 4;

class OutlinePassNode extends PassNode {

	constructor( scene, camera, resolution, selectedObjects, uniformObject ) {

		super( 'color', scene, camera );

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();

		this.updateBeforeType = NodeUpdateType.RENDER;

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

		const resx = Math.round( this.resolution.x / this.downSampleRatio );
		const resy = Math.round( this.resolution.y / this.downSampleRatio );

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

		this._nonSelectedRT = new RenderTarget();
		this._nonSelectedRT.texture.name = 'OutlinePassNode.nonSelected_color';
		this._textures[ this._nonSelectedRT.texture.name ] = this._nonSelectedRT;
		this.renderTarget.depthTexture.type = FloatType;

		const nonSelectedDepthTexture = new DepthTexture();
		nonSelectedDepthTexture.name = 'OutlinePassNode.nonSelected_depth';
		nonSelectedDepthTexture.isRenderTargetTexture = true;
		this._nonSelectedRT.depthTexture = nonSelectedDepthTexture;
		this._textures[ this._nonSelectedRT.depthTexture.name ] = this._nonSelectedRT.depthTexture;

		// Revert render state objects
		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

		this._returnTexture = passTexture( this, this._nonSelectedRT.texture );


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

	updateTextureMatrix() {

		this._textureMatrix.value.set(
			0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 0.5, 0.5,
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
		//this.scene.overrideMaterial = this._prepareMaskMaterial;

		// Make non selected objects invisible, and draw only the selected objects, by comparing the depth buffer of non selected objects
		this.changeVisibilityOfNonSelectedObjects( false );
		renderer.setRenderTarget( this.renderTarget );
		renderer.setMRT( this._mrt );
		renderer.render( scene, camera );

		// Make non selected objects visible, revert scene override material and background
		this.changeVisibilityOfNonSelectedObjects( true );
		this._visibilityCache.clear();

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

		this.renderTarget.setSize( effectiveWidth, effectiveHeight );
		this._nonSelectedRT.setSize( effectiveWidth, effectiveHeight );

	}

	setup( builder ) {

		this._prepareMaskMaterial = this._prepareMaskMaterial || builder.createNodeMaterial();

		this._prepareMaskMaterial.vertexNode = tslFn( () => {

			varyingProperty( 'vec4', 'vPosition').assign( vec4( modelViewPosition, 1.0 ) );
			varyingProperty( 'vec4', 'vProjTexCoord' ).assign( this._textureMatrix.mul( modelWorldMatrix.mul( positionLocal ) ) );

			return positionLocal;

		} );

		this._prepareMaskMaterial.fragmentNode = tslFn(() => {

			const vPosition = varyingProperty( 'vec4', 'vPosition' );
			const vProjTexCoord = varyingProperty( 'vec4', 'vProjTexCoord' );

		})
		this._prepareMaskMaterial.fragmentNode = compositePass().context( builder.getSharedContext() );
		this._compositeMaterial.needsUpdate = true;
		const color = super.getTextureNode( 'output' );
		return color;

	}

}

export const outlinePass = ( scene, camera, resolution, selectedObjects, uniformObject ) => nodeObject( new OutlinePassNode( scene, camera, resolution, selectedObjects, uniformObject ) );

addNodeElement( 'outlinePass', outlinePass );

export default OutlinePassNode;
