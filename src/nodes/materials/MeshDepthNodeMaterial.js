import NodeMaterial, { addNodeMaterial } from './NodeMaterial.js';
import { diffuseColor } from '../core/PropertyNode.js';
import { directionToColor } from '../utils/PackingNode.js';
import { materialOpacity } from '../accessors/MaterialNode.js';
import { transformedNormalView } from '../accessors/NormalNode.js';
import { float, vec4 } from '../shadernode/ShaderNode.js';

import { MeshDepthMaterial } from '../../materials/MeshDepthMaterial.js';
import { linearDepth } from '../Nodes.js';

const _defaultValues = /*@__PURE__*/ new MeshDepthMaterial();

class MeshDepthNodeMaterial extends NodeMaterial {

	constructor( parameters ) {

		super();

		this.lights = false;

		this.isMeshDepthNodeMaterial = true;

		this.setDefaultValues( _defaultValues );

		this.setValues( parameters );

	}

	setupDiffuseColor() {

		diffuseColor.assign( vec4(1.0, 0.0, 0.0, 1.0) );

	}

}

export default MeshDepthNodeMaterial;

addNodeMaterial( 'MeshDepthNodeMaterial', MeshDepthNodeMaterial );