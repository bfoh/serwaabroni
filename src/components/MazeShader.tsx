import { useRef, useEffect } from 'react'

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_grid;

#define PI 3.14159265359
#define TAU 6.28318530718

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float edge(vec2 a, vec2 b, vec2 p) {
  vec2 ab = b - a;
  float l2 = dot(ab, ab);
  if (l2 < 0.001) return distance(p, a);
  float t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  return distance(p, a + t * ab);
}

float cellLine(vec2 cell, vec2 p, float dir, float t) {
  vec2 offset = vec2(0.0);
  float angle = 0.0;
  float dist = 0.0;
  if (dir < 0.5) {
    offset.x = hash(cell * 1.131 + 0.317);
    angle = (hash(cell * 2.731 + 1.117) - 0.5) * 0.6;
    vec2 start = vec2(cell.x + offset.x, cell.y + 0.5 + angle);
    vec2 end = vec2(cell.x + offset.x + 1.0, cell.y + 0.5 - angle);
    dist = min(edge(start, end, p), edge(start + vec2(-1.0, 0.0), end + vec2(-1.0, 0.0), p));
  } else {
    offset.y = hash(cell * 1.531 + 0.817);
    angle = (hash(cell * 2.231 + 0.717) - 0.5) * 0.6;
    vec2 start = vec2(cell.x + 0.5 + angle, cell.y + offset.y);
    vec2 end = vec2(cell.x + 0.5 - angle, cell.y + offset.y + 1.0);
    dist = min(edge(start, end, p), edge(start + vec2(0.0, -1.0), end + vec2(0.0, -1.0), p));
  }
  float lw = 0.04 + 0.02 * sin(t * 0.7 + hash(cell * 3.317) * TAU);
  float glow = 0.008;
  return 1.0 - smoothstep(lw, lw + glow, dist);
}

float cornerPoint(vec2 cell, vec2 p, float t) {
  vec2 cp = cell + 0.5;
  float d = distance(p, cp);
  float size = 0.06 + 0.02 * sin(t * 1.1 + hash(cell * 4.131) * TAU);
  return 1.0 - smoothstep(size, size + 0.006, d);
}

vec3 cellColor(vec2 cell, float t) {
  float hue = fract(hash(cell * 5.431) * 0.08 + 0.00);
  float sat = 0.8 + 0.2 * sin(t * 0.3 + hash(cell * 6.731) * TAU);
  vec3 rgb = vec3(1.0, 0.1 + 0.1 * hash(cell * 2.131), 0.05 + 0.05 * hash(cell * 3.317));
  float pulse = 0.85 + 0.15 * sin(t * 2.0 + hash(cell * 7.231) * TAU);
  return rgb * pulse;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 grid = uv * aspect * 12.0;
  vec2 cell = floor(grid);

  float lineVal = 0.0;
  float pointVal = 0.0;
  vec3 lineColor = vec3(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 neighbor = cell + vec2(float(dx), float(dy));
      float dir = hash(neighbor * 1.731 + 0.217);
      float cLine = cellLine(neighbor, grid, dir, u_time);
      float cPoint = cornerPoint(neighbor, grid, u_time);
      lineVal += cLine;
      pointVal = max(pointVal, cPoint);
      if (cLine > 0.001) {
        lineColor += cellColor(neighbor, u_time) * cLine;
      }
    }
  }

  lineColor /= max(lineVal, 0.001);

  vec3 bgTint = vec3(0.10, 0.08, 0.05) + vec3(0.02, 0.01, 0.0) * noise(grid * 0.5 + u_time * 0.1);
  float gridFade = smoothstep(0.0, 0.5, uv.x) * smoothstep(1.0, 0.5, uv.x) * smoothstep(0.0, 0.5, uv.y) * smoothstep(1.0, 0.5, uv.y);
  vec3 corridorColor = mix(bgTint, lineColor, smoothstep(0.0, 0.3, lineVal));
  vec3 finalColor = mix(corridorColor, vec3(1.0, 0.9, 0.7), pointVal * 0.5);
  float vig = 1.0 - 0.3 * length((uv - 0.5) * 1.5);
  finalColor *= vig * (0.5 + 0.5 * gridFade);

  gl_FragColor = vec4(finalColor, 1.0);
}
`

export default function MazeShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return

    // Compile shaders
    function compileShader(src: string, type: number): WebGLShader | null {
      const shader = gl!.createShader(type)
      if (!shader) return null
      gl!.shaderSource(shader, src)
      gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl!.getShaderInfoLog(shader))
        gl!.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = compileShader(VERTEX_SHADER, gl.VERTEX_SHADER)
    const fs = compileShader(FRAGMENT_SHADER, gl.FRAGMENT_SHADER)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      return
    }

    gl.useProgram(program)

    // Fullscreen triangle
    const vertices = new Float32Array([-1, -1, 3, -1, -1, 3])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const aPosLoc = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPosLoc)
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0)

    // Uniforms
    const uResolution = gl.getUniformLocation(program, 'u_resolution')
    const uTime = gl.getUniformLocation(program, 'u_time')
    const uGrid = gl.getUniformLocation(program, 'u_grid')

    gl.uniform2f(uGrid, 12.0, 12.0)

    // Resize handler
    function resize() {
      if (!canvas || !gl) return
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uResolution, canvas.width, canvas.height)
    }

    resize()
    window.addEventListener('resize', resize)

    // Animation loop
    const startTime = performance.now()

    function render() {
      if (!gl) return
      const elapsed = (performance.now() - startTime) * 0.001
      gl.uniform1f(uTime, elapsed)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buffer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ zIndex: 0 }}
    />
  )
}
