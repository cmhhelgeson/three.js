import { GPUFeatureName } from '../../renderers/webgpu/utils/WebGPUConstants.js';
import Node, { addNodeClass } from '../core/Node.js';
import { NodeUpdateType } from '../core/constants.js';
import { addNodeElement, nodeObject } from '../shadernode/ShaderNode.js';

const ComputeEnableExtension = {
	'chromium-experimental-subgroups': 'chromium_experimental_subgroups',
	'shader-f16': 'f16',
};

class ComputeNode extends Node {

	constructor( computeNode, count, workgroupSize = [ 64 ]) {

		super( 'void' );

		this.isComputeNode = true;

		this.computeNode = computeNode;

		this.count = count;
		this.workgroupSize = workgroupSize;
		this.dispatchCount = 0;

		this.features = [];

		this.version = 1;
		this.updateBeforeType = NodeUpdateType.OBJECT;

		this.updateDispatchCount();

	}

	dispose() {+

		this.dispatchEvent( { type: 'dispose' } );

	}

	set needsUpdate( value ) {

		if ( value === true ) this.version ++;

	}

	updateDispatchCount() {

		const { count, workgroupSize } = this;

		let size = workgroupSize[ 0 ];

		for ( let i = 1; i < workgroupSize.length; i ++ )
			size *= workgroupSize[ i ];

		this.dispatchCount = Math.ceil( count / size );

	}

	enableFeature( feature ) {

		this.features.push( feature );
		return this;

	}

	onInit() { }

	updateBefore( { renderer } ) {

		renderer.compute( this );

	}

	generate( builder ) {

		const { shaderStage } = builder;

		if ( shaderStage === 'compute' ) {

			for ( const feature of this.features ) {

				if ( feature === GPUFeatureName.ChromiumExperimentalSubGroups ) {

					builder.getSubgroupSize();
					builder.getSubgroupIndex();

				}

				console.log(feature)
				const directive = ComputeEnableExtension[ feature ];
				console.log(directive)
				builder.getDirective( directive );

			}

			const snippet = this.computeNode.build( builder, 'void' );

			if ( snippet !== '' ) {

				builder.addLineFlowCode( snippet );

			}

		}

	}

}

export default ComputeNode;

export const compute = ( node, count, workgroupSize, features ) => nodeObject( new ComputeNode( nodeObject( node ), count, workgroupSize, features ) ); 

addNodeElement( 'compute', compute );

addNodeClass( 'ComputeNode', ComputeNode );
