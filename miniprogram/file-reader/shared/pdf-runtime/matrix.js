'use strict'
// The Mini Program context may return a plain six-field transform on phones.
class Matrix {
 constructor(value=[1,0,0,1,0,0]) { const v=Array.isArray(value)||ArrayBuffer.isView(value)?value:[value.a,value.b,value.c,value.d,value.e,value.f];[this.a,this.b,this.c,this.d,this.e,this.f]=v }
 multiplySelf(other) { const {a,b,c,d,e,f}=this;this.a=a*other.a+c*other.b;this.b=b*other.a+d*other.b;this.c=a*other.c+c*other.d;this.d=b*other.c+d*other.d;this.e=a*other.e+c*other.f+e;this.f=b*other.e+d*other.f+f;return this }
 preMultiplySelf(other) { return this.set(new Matrix(other).multiplySelf(this)) }
 set(m) { for(const key of ['a','b','c','d','e','f'])this[key]=m[key];return this }
 multiply(other) { return new Matrix(this).multiplySelf(other) }
 invertSelf() { const {a,b,c,d,e,f}=this,det=a*d-b*c;return this.set({a:d/det,b:-b/det,c:-c/det,d:a/det,e:(c*f-d*e)/det,f:(b*e-a*f)/det}) }
 inverse() { return new Matrix(this).invertSelf() }
 translateSelf(x=0,y=0) { return this.multiplySelf(new Matrix([1,0,0,1,x,y])) }
 translate(x=0,y=0) { return new Matrix(this).translateSelf(x,y) }
 scaleSelf(x=1,y=x) { return this.multiplySelf(new Matrix([x,0,0,y,0,0])) }
 scale(x=1,y=x) { return new Matrix(this).scaleSelf(x,y) }
 transformPoint(p) { return {x:this.a*p.x+this.c*p.y+this.e,y:this.b*p.x+this.d*p.y+this.f} }
}
module.exports=Matrix
