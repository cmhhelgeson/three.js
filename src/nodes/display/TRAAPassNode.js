import PassNode from './PassNode';
import { vec2, vec3, vec4, int, float } from '../shadernode/ShaderNode';
import { loop } from '../utils/LoopNode';
import { floor } from '../math/MathNode';


const texelSize = 4;

class TRAAPassNode extends PassNode {




	setup() {

		const sampleDepth = ( uv ) => this.depthNode.uv( uv ).x;

		const dmin = vec3( 0, 0, 0 );

		loop( { start: int( 0 ), end: int( 9 ), type: 'int', condition: '<' }, ( { i } ) => {

			const xOffset = - 1 + i.remainder( 3 );
			const yOffset = 1 - floor( i.div( 3 ) );

			const depth = sampleDepth( uv().add( vec2( xOffset, yOffset ).mul( texelSize ) ) );
			If( depth.lessThan( dmin.z ), () => {

				dmin.x = xOffset;
				dmin.y = yOffset;
				dmin.z = depth;

			} );

		} );

		return vec3( uv.add( texelSize.xy.mul( dmin.xy ) ), dmin.z );


	}




}
