"""Independent numerical goldens: composite Gauss-Legendre, no reader parser.
Requires NumPy. Run: python scripts/probe-svg-path-length.py OUTPUT.json
"""
import json, math, sys
import numpy as np
from numpy.polynomial.legendre import leggauss
nodes,weights=leggauss(32)
t=np.concatenate([(i+(nodes+1)/2)/128 for i in range(128)])
w=np.tile(weights/(2*128),128)
results=[]
def add(name,source,speed):
 results.append(dict(name=name,path=source,length=float(np.sum(w*speed(t)))))
def cubic(points):
 p=np.array(points);a,b,c=np.diff(p,axis=0)
 return lambda t:3*np.sqrt(np.sum(((1-t[:,None])**2*a+2*t[:,None]*(1-t[:,None])*b+t[:,None]**2*c)**2,axis=1))
for name,p in [('arch',[(20,180),(40,0),(180,0),(220,180)]),('loop',[(0,0),(180,240),(-180,240),(0,0)]),('asymmetric',[(20,30),(40,190),(240,-50),(210,200)])]:
 add(name,'M%s %sC%s %s %s %s %s %s'%tuple(v for point in p for v in point),cubic(p))
# Parabola y=x^2 from0to1 has an analytic length.
results.append(dict(name='parabola',path='M0 0Q.5 0 1 1',length=math.sqrt(5)/2+math.asinh(2)/4))
# A collinear cubic reverses direction at quadratic derivative roots.
p=[30,230,-30,210];a=-p[0]+3*p[1]-3*p[2]+p[3];b=3*p[0]-6*p[1]+3*p[2];c=-3*p[0]+3*p[1]
roots=sorted([0,1]+[float(x) for x in np.roots([3*a,2*b,c]) if 0<x<1]);f=lambda t:a*t**3+b*t*t+c*t+p[0]
results.append(dict(name='cusp',path='M30 128C230 128 -30 128 210 128',length=sum(abs(f(v)-f(u)) for u,v in zip(roots,roots[1:]))))
for rx,ry in [(90,55),(300,.2),(7,120)]:
 add(f'ellipse-{rx}-{ry}',f'M{rx} 0A{rx} {ry} 0 0 1 0 {ry}',lambda t:np.pi/2*np.hypot(rx*np.sin(t*np.pi/2),ry*np.cos(t*np.pi/2)))
results.extend([dict(name='close-subpaths',path='M0 0L3 4ZM10 10L13 14',length=15),dict(name='circle-half',path='M10 0A10 10 0 0 1 -10 0',length=10*math.pi),dict(name='arc-zero-radius',path='M0 0A0 20 0 0 1 3 4',length=5)])
open(sys.argv[1],'w').write(json.dumps(dict(oracle='NumPy composite32-node Gauss-Legendre over128 panels; explicit analytic parabola/cusp/line/circle controls',cases=results),indent=2)+'\n')
