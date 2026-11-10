//go:build !windows

package main

import "errors"

// En Linux y macOS no hay instalación: el programa se ejecuta desde donde esté.

func prepararConsola()                   {}
func puedeInstalarOllama() bool          { return false }
func instalarOllama() error              { return errors.New("solo en Windows") }
func sistemaTieneInstalacion() bool      { return false }
func ofrecerInstalacion(*Config)         {}
func inicioAutomatico() bool             { return false }
func cambiarInicioAutomatico(bool) error { return errors.New("solo en Windows") }
func desinstalar() error                 { return errors.New("solo en Windows") }
