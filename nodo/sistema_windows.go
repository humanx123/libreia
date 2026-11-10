//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const claveInicio = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
const nombreInicio = "LibreIA Nodo"

// prepararConsola: UTF-8 para que se vean las tildes, y título de la ventana.
func prepararConsola() {
	k := syscall.NewLazyDLL("kernel32.dll")
	k.NewProc("SetConsoleOutputCP").Call(65001)
	k.NewProc("SetConsoleCP").Call(65001)
	if t, err := syscall.UTF16PtrFromString("LibreIA Nodo"); err == nil {
		k.NewProc("SetConsoleTitleW").Call(uintptr(unsafePointer(t)))
	}
}

func puedeInstalarOllama() bool     { return true }
func sistemaTieneInstalacion() bool { return true }

func dirInstalacion() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	return filepath.Join(base, "Programs", "LibreIA Nodo")
}
func exeInstalado() string { return filepath.Join(dirInstalacion(), "LibreIA-Nodo.exe") }

func exeActual() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return p
}

func esInstalado() bool {
	return strings.EqualFold(filepath.Clean(exeActual()), filepath.Clean(exeInstalado()))
}

// powershell ejecuta un script corto (sin perfil ni ventana extra).
func powershell(script string) error {
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
func psTexto(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// instalar copia el programa a %LOCALAPPDATA%\Programs\LibreIA Nodo y crea los accesos directos.
func instalar() error {
	if err := os.MkdirAll(dirInstalacion(), 0o755); err != nil {
		return err
	}
	org, err := os.Open(exeActual())
	if err != nil {
		return err
	}
	defer org.Close()
	tmp := exeInstalado() + ".nuevo"
	dst, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, org); err != nil {
		dst.Close()
		return err
	}
	dst.Close()
	if err := os.Rename(tmp, exeInstalado()); err != nil {
		os.Remove(tmp)
		return errors.New("no se pudo reemplazar la copia instalada: cierra las otras ventanas de LibreIA Nodo y vuelve a intentarlo")
	}
	script := fmt.Sprintf(`$w = New-Object -ComObject WScript.Shell
foreach ($d in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $s = $w.CreateShortcut((Join-Path $d 'LibreIA Nodo.lnk'))
  $s.TargetPath = %s
  $s.WorkingDirectory = %s
  $s.Description = 'Presta tu ordenador a la comunidad de LibreIA'
  $s.Save()
}`, psTexto(exeInstalado()), psTexto(dirInstalacion()))
	if err := powershell(script); err != nil {
		fmt.Println("! No se pudieron crear los accesos directos:", err)
	}
	return nil
}

// ofrecerInstalacion: la primera vez (desde Descargas) propone instalarlo y se reabre desde allí.
func ofrecerInstalacion(c *Config) {
	if esInstalado() {
		return
	}
	_, err := os.Stat(exeInstalado())
	yaHay := err == nil
	if c.NoInstalar && !yaHay {
		return
	}
	titulo("Instalación")
	if yaHay {
		fmt.Println("LibreIA Nodo ya está instalado en este ordenador. Esta copia puede ser más nueva.")
		if strings.ToLower(leer("¿Actualizar la copia instalada con esta? (S/n): ")) == "n" {
			return
		}
	} else {
		fmt.Println("Puedo instalar LibreIA Nodo en este ordenador: acceso directo en el escritorio y en el menú Inicio,")
		fmt.Println("y la opción de que se inicie solo con Windows. No necesita permisos de administrador.")
		if strings.ToLower(leer("¿Instalarlo? (S/n): ")) == "n" {
			c.NoInstalar = true
			_ = guardarConfig(*c)
			return
		}
	}
	if err := instalar(); err != nil {
		fmt.Println("✗", err)
		pausa("Sigo con esta copia.")
		return
	}
	fmt.Println("✓ Instalado en", dirInstalacion())
	// Se abre la copia instalada en una ventana nueva y esta se cierra.
	if err := exec.Command("cmd", "/c", "start", "", exeInstalado()).Start(); err == nil {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}
}

func inicioAutomatico() bool {
	return exec.Command("reg", "query", claveInicio, "/v", nombreInicio).Run() == nil
}

func cambiarInicioAutomatico(activar bool) error {
	if !activar {
		if out, err := exec.Command("reg", "delete", claveInicio, "/v", nombreInicio, "/f").CombinedOutput(); err != nil {
			return fmt.Errorf("no se pudo quitar: %s", strings.TrimSpace(string(out)))
		}
		fmt.Println("✓ Ya no se iniciará con Windows.")
		return nil
	}
	if !esInstalado() {
		if err := instalar(); err != nil {
			return err
		}
	}
	// Se abre minimizado y se conecta solo con la configuración guardada.
	valor := fmt.Sprintf(`cmd.exe /c start "" /min "%s"`, exeInstalado())
	if out, err := exec.Command("reg", "add", claveInicio, "/v", nombreInicio, "/t", "REG_SZ", "/d", valor, "/f").CombinedOutput(); err != nil {
		return fmt.Errorf("no se pudo activar: %s", strings.TrimSpace(string(out)))
	}
	fmt.Println("✓ Se iniciará con Windows (minimizado) y se conectará solo.")
	return nil
}

func desinstalar() error {
	_ = exec.Command("reg", "delete", claveInicio, "/v", nombreInicio, "/f").Run()
	_ = powershell(`foreach ($d in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) { Remove-Item -LiteralPath (Join-Path $d 'LibreIA Nodo.lnk') -ErrorAction SilentlyContinue }`)
	if strings.ToLower(leer("¿Borrar también tu configuración y tu token? (s/N): ")) == "s" {
		_ = os.RemoveAll(filepath.Dir(rutaConfig()))
	}
	// La carpeta del programa se borra unos segundos después de cerrar esta ventana.
	_ = exec.Command("cmd", "/c", fmt.Sprintf(`ping 127.0.0.1 -n 4 >nul & rmdir /s /q "%s"`, dirInstalacion())).Start()
	fmt.Println("✓ LibreIA Nodo se ha desinstalado. Gracias por prestar tu ordenador.")
	time.Sleep(2 * time.Second)
	return nil
}

// instalarOllama descarga el instalador oficial de Ollama, lo abre y espera a que el servidor responda.
func instalarOllama() error {
	const url = "https://ollama.com/download/OllamaSetup.exe"
	fmt.Println("\nDescargando el instalador oficial de Ollama (cerca de 1 GB)…")
	res, err := http.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("ollama.com respondió HTTP %d", res.StatusCode)
	}
	ruta := filepath.Join(os.TempDir(), "OllamaSetup.exe")
	f, err := os.Create(ruta)
	if err != nil {
		return err
	}
	total := res.ContentLength
	var hecho int64
	buf := make([]byte, 256*1024)
	ultimo := time.Now()
	for {
		n, er := res.Body.Read(buf)
		if n > 0 {
			if _, ew := f.Write(buf[:n]); ew != nil {
				f.Close()
				return ew
			}
			hecho += int64(n)
			if time.Since(ultimo) > 300*time.Millisecond {
				ultimo = time.Now()
				if total > 0 {
					fmt.Printf("\r  %5.1f%%  (%.0f de %.0f MB)   ", float64(hecho)*100/float64(total), float64(hecho)/1e6, float64(total)/1e6)
				} else {
					fmt.Printf("\r  %.0f MB   ", float64(hecho)/1e6)
				}
			}
		}
		if er == io.EOF {
			break
		}
		if er != nil {
			f.Close()
			return er
		}
	}
	f.Close()
	fmt.Println("\r  ✓ Descargado.                          ")
	fmt.Println("Se abre el instalador de Ollama: sigue sus pasos («Install»). Te espero aquí…")
	if err := exec.Command(ruta).Run(); err != nil {
		return fmt.Errorf("el instalador terminó con error: %v", err)
	}
	fmt.Print("Esperando a que Ollama arranque")
	ctx, cancelar := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancelar()
	for ctx.Err() == nil {
		if _, err := modelos(conocidos[0], 3*time.Second); err == nil {
			fmt.Println(" ✓")
			return nil
		}
		fmt.Print(".")
		time.Sleep(3 * time.Second)
	}
	fmt.Println("\n! Ollama todavía no responde. Ábrelo desde el menú Inicio y elige R para volver a buscar.")
	return nil
}
