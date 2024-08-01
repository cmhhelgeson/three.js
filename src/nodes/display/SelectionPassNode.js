import { addNodeElement, nodeObject } from '../shadernode/ShaderNode.js';
import PassNode from './PassNode.js';
import { NodeUpdateType } from '../core/constants.js';
import { addNodeClass } from '../core/Node.js';

class SelectionPassNode extends PassNode {

	constructor( scope, scene, camera, selectedObjects ) {

		super( 'color', scene, camera );

		this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
		this.scope = scope;
		this._visibilityCache = new Map();

		this.updateBeforeType = NodeUpdateType.RENDER;

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

	updateBefore( frame ) {

		this.scope === SelectionPassNode.SELECTED ? ( this.changeVisibilityOfNonSelectedObjects( false ) ) : ( this.changeVisibilityOfSelectedObjects( false ) );

		super.updateBefore( frame );

		this.scope === SelectionPassNode.SELECTED ? ( this.changeVisibilityOfNonSelectedObjects( true ) ) : ( this.changeVisibilityOfSelectedObjects( true ) );
		this._visibilityCache.clear();

	}

	setup() {

		return this.getTextureNode( 'output' );

	}

}

export default SelectionPassNode;

SelectionPassNode.SELECTED = 'selected';
SelectionPassNode.NONSELECTED = 'nonSelected';

export const selectedPass = ( scene, camera, selectedObjects ) => nodeObject( new SelectionPassNode( SelectionPassNode.SELECTED, scene, camera, selectedObjects ) );
export const nonSelectedPass = ( scene, camera, selectedObjects ) => nodeObject( new SelectionPassNode( SelectionPassNode.NONSELECTED, scene, camera, selectedObjects ) );

addNodeElement( 'selectedPass', selectedPass );
addNodeElement( 'nonSelectedPass', nonSelectedPass );

addNodeClass( 'SelectionPassNode', SelectionPassNode );
