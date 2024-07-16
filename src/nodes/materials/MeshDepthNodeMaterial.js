import { MeshDepthMaterial } from "../../materials/MeshDepthMaterial";
import NodeMaterial, { addNodeMaterial } from "./NodeMaterial";
import { depth, linearDepth, viewportLinearDepth } from '../display/ViewportDepthNode';
import { viewportDepthTexture } from "../display/ViewportDepthTextureNode";

const defaultValues = new MeshDepthMaterial();

class MeshDepthNodeMaterial extends NodeMaterial {

	constructor( parameters ) {

		super();

		this.lights = false;

		this.isMeshDepthNodeMaterial = true;

		this.type = 'MeshDepthMaterial';

		this.setDefaultValues( defaultValues );
		this.setValues( parameters )

	}

	setupDiffuseColor() {

		diffuseColor.assign( vec4(linearDepth, linearDepth, linearDepth, 1.0) );


	}

}

export default MeshDepthNodeMaterial;

addNodeMaterial( 'MeshDepthNodeMaterial', MeshDepthNodeMaterial );