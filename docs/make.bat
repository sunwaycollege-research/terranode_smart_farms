@ECHO OFF
REM TERANODE docs build (Windows). Usage: make.bat [html|doxygen|all|clean]
pushd %~dp0
set SPHINXBUILD=python -m sphinx
set BUILDDIR=_build

if "%1"=="" goto all
if "%1"=="all" goto all
if "%1"=="doxygen" goto doxygen
if "%1"=="html" goto html
if "%1"=="clean" goto clean
goto end

:doxygen
doxygen doxygen\Doxyfile
goto end

:html
doxygen doxygen\Doxyfile
%SPHINXBUILD% -b html . %BUILDDIR%\html
goto end

:all
doxygen doxygen\Doxyfile
%SPHINXBUILD% -b html . %BUILDDIR%\html
echo Done. Open %BUILDDIR%\html\index.html
goto end

:clean
rmdir /s /q %BUILDDIR% doxygen\html doxygen\xml 2>nul
goto end

:end
popd
