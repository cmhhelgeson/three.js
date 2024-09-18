
import QuadMesh from '../../renderers/common/QuadMesh';
import { Vector2 } from '../../math/Vector2';
import PassNode from './PassNode';
import { uniform } from '../core/UniformNode.js';
import { vec2, vec3, vec4, color, nodeObject, Fn, mix } from '../tsl/TSLBase.js';
import { Matrix4 } from '../../math/Matrix4.js';
import { texture } from '../accessors/TextureNode.js';
import { RenderTarget } from '../../core/RenderTarget.js';
import { DepthTexture } from '../../textures/DepthTexture.js';
import { Color } from '../../math/Color.js';
import { uv } from '../accessors/UV.js';
import NodeMaterial from '../../materials/nodes/NodeMaterial.js';
import { sobel } from './SobelOperatorNode.js';
import { gaussianBlur } from './GaussianBlurNode.js';
import { AdditiveBlending, SubtractiveBlending } from '../../constants.js';
import { perspectiveDepthToViewZ, viewZToOrthographicDepth } from './ViewportDepthNode.js';

const _quadMesh = new QuadMesh();
const _size = new Vector2();

class OutlinePassNode extends PassNode {

	constructor( resolution, scene, camera, uniformObject, selectedObjects ) {

		super( PassNode.COLOR, scene, camera );

		this.resolution = ( resolution !== undefined ) ? new Vector2( resolution.x, resolution.y ) : new Vector2( 256, 256 );

		// Selection Objects
		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this._visibilityCache = new Map();
		this._selectionCache = new Set();

		// Materials
		this._downSampleMaterial = null;
		this._overlayMaterial = null;

		// User-adjusted uniforms
		uniformObject = uniformObject !== undefined ? uniformObject : {};
		this.visibleEdgeColor = uniformObject.visibleEdgeColor || color( 1, 1, 1 );
		this.hiddenEdgeColor = uniformObject.hiddenEdgeColor || color( 0.1, 0.24, 0.5 );
		this.edgeGlow = uniformObject.edgeGlow || 0.0;
		this.usePatternTexture = uniformObject.usePatternTexture || 0;
		this.edgeThickness = uniformObject.edgeThickness || uniform( 1.0 );
		this.edgeStrength = uniformObject.edgeStrength || uniform( 3.0 );
		this.downSampleRatio = uniformObject.downSampleRatio || 2;
		this.pulsePeriod = uniformObject.pulsePeriod || 0;
		this.blurIterations = uniformObject.blurIterations || 2;

		// Internal uniforms ( per Output Pass )
		this._invSize = uniform( vec2( 0.5, 0.5 ) );

		// Render targets
		this._selectedRT = this.createOutlinePassTarget( 'SelectedRT' );
		this._sceneRT = this.createOutlinePassTarget( 'SceneRT' );

		// Textures
		this._selectedColor = texture( this._selectedRT.texture );
		this._selectedDepth = texture( this._selectedRT.depthTexture );
		this._sceneColor = texture( this._sceneRT.texture );
		this._sceneDepth = texture( this._sceneRT.depthTexture );

		// Revert render state objects
		this._oldClearColor = new Color();
		this.oldClearAlpha = 1;

	}

	createOutlinePassTarget( name ) {

		const rt = new RenderTarget();
		rt.texture.name = `OutlinePassNode.${name}_color`;
		const dt = new DepthTexture();
		dt.name = `OutlinePassNode.${name}_depth`;
		dt.isRenderTargetTexture = true;
		rt.depthTexture = dt;

		return rt;

	}

	updateSelectionCache() {

		const cache = this._selectionCache;

		function gatherSelectedMeshesCallBack( object ) {

			if ( object.isMesh ) cache.add( object );

		}

		cache.clear();

		for ( let i = 0; i < this.selectedObjects.length; i ++ ) {

			const selectedObject = this.selectedObjects[ i ];
			selectedObject.traverse( gatherSelectedMeshesCallBack );

		}

	}

	changeVisibilityOfSelectedObjects( bVisible ) {

		const cache = this._visibilityCache;

		for ( const mesh of this._selectionCache ) {

			if ( bVisible === true ) {

				mesh.visible = cache.get( mesh );

			} else {

				cache.set( mesh, mesh.visible );
				mesh.visible = bVisible;

			}

		}

	}

	changeVisibilityOfNonSelectedObjects( bVisible ) {

		const visibilityCache = this._visibilityCache;
		const selectionCache = this._selectionCache;

		function VisibilityChangeCallBack( object ) {

			if ( object.isMesh || object.isSprite ) {

				// only meshes and sprites are supported by OutlinePass

				if ( ! selectionCache.has( object ) ) {

					const visibility = object.visible;

					if ( bVisible === false || visibilityCache.get( object ) === true ) {

						object.visible = bVisible;

					}

					visibilityCache.set( object, visibility );

				}

			} else if ( object.isPoints || object.isLine ) {

				// the visibilty of points and lines is always set to false in order to
				// not affect the outline computation

				if ( bVisible === true ) {

					object.visible = visibilityCache.get( object ); // restore

				} else {

					visibilityCache.set( object, object.visible );
					object.visible = bVisible;

				}

			}

		}

		this.scene.traverse( VisibilityChangeCallBack );

	}

	updateBefore( frame ) {

		const { renderer } = frame;
		const { scene, camera, _selectedRT } = this;

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

		renderer.autoClear = false;
		//renderer.setClearColor( 0xffffff, 1 );

		// 1. Draw Non Selected objects in the depth buffer
		this.updateSelectionCache();

		renderer.setRenderTarget( this._sceneRT );
		renderer.clear();
		renderer.setMRT( null );
		renderer.render( scene, camera );

		// Make selected objects visible
		this._visibilityCache.clear();

		// 2. Draw selected objects in the depth buffer
		this.changeVisibilityOfNonSelectedObjects( false );

		renderer.setRenderTarget( _selectedRT );
		renderer.clear();
		renderer.render( scene, camera );

		// Make non selected objects visible, revert scene override material and background
		this.changeVisibilityOfNonSelectedObjects( true );
		this._visibilityCache.clear();
		this._selectionCache.clear();

		// 3. Prepare Mask
		renderer.setRenderTarget( this._sceneRT );
		_quadMesh.material = this._overlayMaterial;
		_quadMesh.render( renderer );

		// Reset extant render state
		//renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
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
		this._selectedRT.setSize( effectiveWidth, effectiveHeight );
		this._sceneRT.setSize( effectiveWidth, effectiveHeight );

	}

	dispose() {

		this._selectedRT.dispose();
		this._sceneRT.dispose();

		if ( this._overlayMaterial !== null ) {

			this._overlayMaterial.dispose();


		}

	}

	setup( builder ) {

		const uvNode = uv();

		const edgeOverlay = Fn( () => {

			// Creates the edge
			const edgePass = sobel( this._selectedColor.uv( uvNode ).a );

			const sceneViewZ = perspectiveDepthToViewZ( this._sceneDepth, this._cameraNear, this._cameraFar );
			const selectedViewZ = perspectiveDepthToViewZ( this._selectedDepth, this._cameraNear, this._cameraFar );

			// Sets color dependent on edge depth
			const edgeColor = sceneViewZ.greaterThan( selectedViewZ ).select( this.visibleEdgeColor, this.hiddenEdgeColor );

			// Mixes color in
			const coloredEdgePass = edgePass.r.mix( vec3( 0.0 ), edgeColor );

			return coloredEdgePass;

		} );

		const overlayMaterial = this._overlayMaterial || ( this._overlayMaterial = new NodeMaterial() );
		overlayMaterial.fragmentNode = edgeOverlay().context( builder.getSharedContext() );
		overlayMaterial.name = 'Overlay';
		overlayMaterial.blending = AdditiveBlending;
		overlayMaterial.depthTest = false,
		overlayMaterial.depthWrite = false,
		overlayMaterial.transparent = true;

		return this._sceneColor;

	}

}

export const outlinePass = ( resolution, scene, camera, selectedObjects, uniformObject ) => nodeObject( new OutlinePassNode( resolution, scene, camera, selectedObjects, uniformObject ) );

