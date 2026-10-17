//! Browser-only compile shim. All dynamic plugin loading fails closed.
//! Sudachi's bundled plugins still use the original upstream implementation.
use std::{ffi::OsStr, fmt, marker::PhantomData, ops::Deref};

#[derive(Debug)]
pub enum Error { IncompatibleSize }
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "Dynamic plugins are disabled in the browser") }
}
impl std::error::Error for Error {}
pub struct Library;
impl Library {
    pub unsafe fn new<P: AsRef<OsStr>>(_: P) -> Result<Self, Error> { Err(Error::IncompatibleSize) }
    pub unsafe fn get<T>(&self, _: &[u8]) -> Result<Symbol<'_, T>, Error> { Err(Error::IncompatibleSize) }
}
pub struct Symbol<'a, T>(PhantomData<&'a T>);
impl<T> Deref for Symbol<'_, T> {
    type Target = T;
    fn deref(&self) -> &T { unreachable!("Dynamic symbols cannot be loaded in a browser") }
}
