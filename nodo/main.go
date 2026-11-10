// LibreIA Nodo: presta tu ordenador para que tu modelo local responda a la comunidad de LibreIA.
//
// Un asistente en español elige el proveedor local (Ollama, LM Studio, llama.cpp, KoboldCpp, Jan,
// GPT4All, vLLM u otro que añadas) y el modelo (o descarga uno con Ollama), lo prueba y conecta el
// nodo. No hace falta programar ni instalar Node.js.
//
// Qué hace y qué no:
//   - Abre una conexión de SALIDA hacia LibreIA (no abre puertos en tu red ni expone tu servidor local).
//   - Responde una pregunta a la vez, con el modelo que elijas.
//   - NO guarda ni muestra las preguntas: solo cuenta cuántas respondió.
//
// Uso avanzado sin asistente (servidores, scripts), con las mismas opciones que libreia-nodo.mjs:
//
//	LibreIA-Nodo --token TU_TOKEN [--api http://127.0.0.1:11434/v1] [--modelo NOMBRE] [--nombre ALIAS] [--clave CLAVE]
//
// Software libre (AGPL-3.0) · https://github.com/humanx123/libreia
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const version = "1.0.0"
const servidorPorDefecto = "wss://libreia-api.libreia-chat-mobile.workers.dev/v1/red/conectar"

// Proveedor: un servidor local compatible con la API de OpenAI.
type Proveedor struct {
	Nombre string `json:"nombre"`
	URL    string `json:"url"`
	Clave  string `json:"clave,omitempty"` // solo si tu servidor local pide clave
	Web    string `json:"web,omitempty"`   // dónde descargarlo
	Ollama bool   `json:"ollama,omitempty"`
}

var conocidos = []Proveedor{
	{Nombre: "Ollama", URL: "http://127.0.0.1:11434/v1", Web: "https://ollama.com/download", Ollama: true},
	{Nombre: "LM Studio", URL: "http://127.0.0.1:1234/v1", Web: "https://lmstudio.ai"},
	{Nombre: "llama.cpp (llama-server) o LocalAI", URL: "http://127.0.0.1:8080/v1", Web: "https://github.com/ggml-org/llama.cpp/releases"},
	{Nombre: "KoboldCpp", URL: "http://127.0.0.1:5001/v1", Web: "https://github.com/LostRuins/koboldcpp/releases"},
	{Nombre: "Jan", URL: "http://127.0.0.1:1337/v1", Web: "https://jan.ai"},
	{Nombre: "GPT4All", URL: "http://127.0.0.1:4891/v1", Web: "https://www.nomic.ai/gpt4all"},
	{Nombre: "vLLM", URL: "http://127.0.0.1:8000/v1", Web: "https://docs.vllm.ai"},
}

// Modelos recomendados para descargar con Ollama (tamaño de la descarga). Cualquier otro de
// https://ollama.com/library se puede escribir a mano.
var recomendados = []struct{ Nombre, Peso, Nota string }{
	{"llama3.2:3b", "2,0 GB", "ligero: ordenadores con 8 GB de RAM"},
	{"gemma3:4b", "3,4 GB", "equilibrado, buen español (recomendado)"},
	{"qwen3:4b", "2,5 GB", "razona antes de responder: más lento"},
	{"mistral:7b", "4,4 GB", "16 GB de RAM"},
	{"llama3.1:8b", "4,9 GB", "16 GB de RAM"},
	{"gemma3:12b", "8,2 GB", "tarjeta gráfica o 32 GB de RAM"},
}

type Config struct {
	Token     string      `json:"token"`
	Proveedor Proveedor   `json:"proveedor"`
	Modelo    string      `json:"modelo"`
	Nombre    string      `json:"nombre"`
	Propios   []Proveedor `json:"proveedoresPropios,omitempty"`
	Servidor  string      `json:"servidor,omitempty"`
	// La persona dijo que no quiere instalarlo en el ordenador (no se vuelve a preguntar).
	NoInstalar bool `json:"noInstalar,omitempty"`
}

var (
	reToken  = regexp.MustCompile(`^n1\.[0-9a-f]{32}\.[0-9a-f]{16}\.\d{1,9}\.[0-9a-f]{32}$`)
	reAlias  = regexp.MustCompile(`[^A-Za-z0-9_ .:/@+-]`) // lo mismo que acepta el servidor
	rePiensa = regexp.MustCompile(`(?s)<think>.*?(</think>|$)`)
	entrada  = bufio.NewReader(os.Stdin)
	cliente  = &http.Client{}
)

func rutaConfig() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "LibreIA", "nodo.json")
}

func cargarConfig() Config {
	var c Config
	if b, err := os.ReadFile(rutaConfig()); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func guardarConfig(c Config) error {
	ruta := rutaConfig()
	if err := os.MkdirAll(filepath.Dir(ruta), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	// El token es como una contraseña: el archivo solo lo puede leer tu usuario.
	return os.WriteFile(ruta, b, 0o600)
}

func (c Config) completa() bool {
	return reToken.MatchString(c.Token) && c.Proveedor.URL != "" && c.Modelo != ""
}

// ---------------------------------------------------------------- consola

func hora() string { return time.Now().Format("15:04:05") }

// leer muestra una pregunta y devuelve la línea escrita (sin espacios a los lados).
func leer(pregunta string) string {
	fmt.Print(pregunta)
	linea, err := entrada.ReadString('\n')
	if err != nil && linea == "" {
		if errors.Is(err, io.EOF) {
			fmt.Println("\nHasta pronto.")
			os.Exit(0)
		}
	}
	return strings.TrimSpace(linea)
}

func pausa(texto string) {
	leer("\n" + texto + " Pulsa Enter para continuar…")
}

func titulo(t string) {
	fmt.Printf("\n════ %s ════\n", t)
}

// ---------------------------------------------------------------- servidor local

func pedirLocal(ctx context.Context, p Proveedor, metodo, ruta string, cuerpo any) (*http.Response, error) {
	var lector io.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		lector = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, metodo, strings.TrimRight(p.URL, "/")+ruta, lector)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.Clave != "" {
		req.Header.Set("Authorization", "Bearer "+p.Clave)
	}
	return cliente.Do(req)
}

// modelos devuelve los modelos de chat que ofrece el servidor local.
func modelos(p Proveedor, espera time.Duration) ([]string, error) {
	ctx, cancelar := context.WithTimeout(context.Background(), espera)
	defer cancelar()
	res, err := pedirLocal(ctx, p, "GET", "/models", nil)
	if err != nil {
		return nil, errors.New("no responde")
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return nil, errors.New("pide una clave")
	}
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("respondió HTTP %d", res.StatusCode)
	}
	var d struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&d); err != nil {
		return nil, errors.New("respuesta no compatible con OpenAI")
	}
	var ids []string
	for _, m := range d.Data {
		if m.ID != "" && !strings.Contains(strings.ToLower(m.ID), "embed") {
			ids = append(ids, m.ID)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// responder envía la conversación al modelo local y devuelve el texto (sin el bloque <think>).
func responder(p Proveedor, modelo string, mensajes json.RawMessage, maxTokens int, temperatura *float64, espera time.Duration) (string, error) {
	if maxTokens <= 0 {
		maxTokens = 800
	}
	temp := 0.7
	if temperatura != nil {
		temp = *temperatura
	}
	ctx, cancelar := context.WithTimeout(context.Background(), espera)
	defer cancelar()
	res, err := pedirLocal(ctx, p, "POST", "/chat/completions", map[string]any{
		"model": modelo, "messages": mensajes, "max_tokens": maxTokens, "temperature": temp, "stream": false,
	})
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf("el modelo tardó más de %d s", int(espera.Seconds()))
		}
		return "", errors.New("el servidor local no responde")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("servidor local HTTP %d", res.StatusCode)
	}
	var d struct {
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&d); err != nil || len(d.Choices) == 0 {
		return "", errors.New("respuesta no compatible con OpenAI")
	}
	texto := ""
	var s string
	var partes []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(d.Choices[0].Message.Content, &s) == nil {
		texto = s
	} else if json.Unmarshal(d.Choices[0].Message.Content, &partes) == nil {
		for _, x := range partes {
			texto += x.Text
		}
	}
	texto = strings.TrimSpace(rePiensa.ReplaceAllString(texto, ""))
	if texto == "" {
		return "", errors.New("el modelo devolvió una respuesta vacía")
	}
	return texto, nil
}

// ---------------------------------------------------------------- asistente

func pasoToken(c *Config) {
	titulo("1/4 · Tu token de nodo")
	fmt.Println("En la app de LibreIA: Ajustes → «Presta tu ordenador» → «Generar mi token de nodo» → Copiar.")
	fmt.Println("Pégalo aquí (en esta ventana: clic derecho o Ctrl+V).")
	for {
		actual := ""
		if reToken.MatchString(c.Token) {
			actual = " [Enter = mantener el guardado]"
		}
		t := leer("Token" + actual + ": ")
		// Se acepta también el comando entero copiado de la app.
		if m := regexp.MustCompile(`n1\.[0-9a-f.]+`).FindString(t); m != "" {
			t = m
		}
		if t == "" && actual != "" {
			return
		}
		if reToken.MatchString(t) {
			c.Token = t
			return
		}
		fmt.Println("✗ Eso no parece un token de nodo (empieza por «n1.»). Cópialo otra vez desde la app.")
	}
}

type estadoProveedor struct {
	p      Proveedor
	modelo []string
	err    error
}

func detectar(lista []Proveedor) []estadoProveedor {
	out := make([]estadoProveedor, len(lista))
	var wg sync.WaitGroup
	for i, p := range lista {
		wg.Add(1)
		go func(i int, p Proveedor) {
			defer wg.Done()
			ms, err := modelos(p, 2500*time.Millisecond)
			out[i] = estadoProveedor{p, ms, err}
		}(i, p)
	}
	wg.Wait()
	return out
}

func pasoProveedor(c *Config) {
	for {
		titulo("2/4 · Proveedor local (el programa que ejecuta el modelo)")
		fmt.Println("Buscando proveedores en este ordenador…")
		lista := append(append([]Proveedor{}, conocidos...), c.Propios...)
		estados := detectar(lista)
		for i, e := range estados {
			marca := "·  no detectado"
			if e.err == nil {
				marca = "✓  funcionando (" + cuantos(len(e.modelo)) + ")"
			} else if e.err.Error() != "no responde" {
				marca = "!  " + e.err.Error()
			}
			propio := ""
			if i >= len(conocidos) {
				propio = " (añadido por ti)"
			}
			fmt.Printf("  %d) %-36s %s\n     %s\n", i+1, e.p.Nombre+propio, marca, e.p.URL)
		}
		fmt.Println("\n  A) Añadir otro proveedor (cualquier servidor compatible con OpenAI, en este PC o en tu red)")
		if len(c.Propios) > 0 {
			fmt.Println("  B) Borrar un proveedor añadido")
		}
		if puedeInstalarOllama() {
			fmt.Println("  I) Instalar Ollama (gratis; es el más sencillo)")
		}
		fmt.Println("  R) Volver a buscar")
		op := strings.ToLower(leer("\nElige: "))
		switch op {
		case "a":
			if p, ok := anadirProveedor(); ok {
				c.Propios = append(c.Propios, p)
				_ = guardarConfig(*c)
			}
			continue
		case "b":
			if len(c.Propios) > 0 {
				for i, p := range c.Propios {
					fmt.Printf("  %d) %s  %s\n", i+1, p.Nombre, p.URL)
				}
				var n int
				if _, err := fmt.Sscan(leer("Número a borrar (Enter = ninguno): "), &n); err == nil && n >= 1 && n <= len(c.Propios) {
					c.Propios = append(c.Propios[:n-1], c.Propios[n:]...)
					_ = guardarConfig(*c)
				}
			}
			continue
		case "i":
			if puedeInstalarOllama() {
				if err := instalarOllama(); err != nil {
					fmt.Println("✗ No se pudo instalar Ollama:", err)
					fmt.Println("  Descárgalo a mano desde https://ollama.com/download")
					pausa("")
				}
			}
			continue
		case "r", "":
			continue
		}
		var n int
		if _, err := fmt.Sscan(op, &n); err != nil || n < 1 || n > len(estados) {
			fmt.Println("✗ Opción no válida.")
			continue
		}
		e := estados[n-1]
		if e.err != nil {
			fmt.Printf("\n%s no responde en %s (%s).\n", e.p.Nombre, e.p.URL, e.err)
			if e.p.Ollama {
				fmt.Println("  · Si no lo tienes, elige I para instalarlo. Si ya lo tienes, ábrelo (icono de la llama).")
			} else if e.p.Web != "" {
				fmt.Printf("  · Descárgalo en %s, ábrelo, carga un modelo y activa su servidor local.\n", e.p.Web)
			}
			if e.p.Nombre == "LM Studio" {
				fmt.Println("  · En LM Studio: pestaña «Developer» → «Start Server».")
			}
			if strings.ToLower(leer("¿Usarlo de todas formas? (s/N): ")) != "s" {
				continue
			}
		}
		c.Proveedor = e.p
		return
	}
}

func anadirProveedor() (Proveedor, bool) {
	titulo("Añadir proveedor")
	fmt.Println("Sirve cualquier servidor compatible con la API de OpenAI (/v1/models y /v1/chat/completions).")
	nombre := leer("Nombre (por ejemplo «Mi servidor»): ")
	url := leer("Dirección (por ejemplo http://127.0.0.1:9000/v1 o 192.168.1.20:11434): ")
	if url == "" {
		return Proveedor{}, false
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "http://" + url
	}
	url = strings.TrimRight(url, "/")
	clave := leer("Clave del servidor, si la pide (Enter = sin clave): ")
	if nombre == "" {
		nombre = url
	}
	p := Proveedor{Nombre: nombre, URL: url, Clave: clave}
	// Si no se escribió la ruta, se prueba también con /v1.
	if _, err := modelos(p, 4*time.Second); err != nil && !strings.HasSuffix(url, "/v1") {
		q := p
		q.URL = url + "/v1"
		if _, err2 := modelos(q, 4*time.Second); err2 == nil {
			p = q
		}
	}
	// ¿Es un Ollama (en otro ordenador, otro puerto…)? Entonces también se pueden descargar modelos.
	if res, err := (&http.Client{Timeout: 4 * time.Second}).Get(strings.TrimSuffix(p.URL, "/v1") + "/api/tags"); err == nil {
		res.Body.Close()
		p.Ollama = res.StatusCode == 200
	}
	if ms, err := modelos(p, 4*time.Second); err != nil {
		fmt.Printf("! Ahora mismo %s %s. Lo guardo igualmente.\n", p.URL, err)
	} else {
		fmt.Printf("✓ Funciona: %s.\n", cuantos(len(ms)))
	}
	return p, true
}

func pasoModelo(c *Config) bool {
	for {
		titulo("3/4 · Modelo")
		ms, err := modelos(c.Proveedor, 6*time.Second)
		if err != nil {
			fmt.Printf("! %s %s.\n", c.Proveedor.Nombre, err)
		}
		for i, m := range ms {
			marca := ""
			if m == c.Modelo {
				marca = "   ← el actual"
			}
			fmt.Printf("  %d) %s%s\n", i+1, m, marca)
		}
		if len(ms) == 0 && err == nil {
			fmt.Println("  (no tiene ningún modelo todavía)")
		}
		fmt.Println()
		if c.Proveedor.Ollama {
			fmt.Println("  D) Descargar un modelo recomendado")
		}
		fmt.Println("  O) Otro modelo: escribir su nombre" + map[bool]string{true: " (cualquiera de ollama.com/library)", false: ""}[c.Proveedor.Ollama])
		fmt.Println("  R) Volver a buscar      V) Volver al paso anterior")
		op := strings.ToLower(leer("\nElige: "))
		switch op {
		case "v":
			return false
		case "r", "":
			continue
		case "d":
			if !c.Proveedor.Ollama {
				continue
			}
			fmt.Println("\nModelos recomendados (se descargan una vez y quedan en tu ordenador):")
			for i, r := range recomendados {
				fmt.Printf("  %d) %-13s %7s   %s\n", i+1, r.Nombre, r.Peso, r.Nota)
			}
			var n int
			if _, err := fmt.Sscan(leer("Número (Enter = cancelar): "), &n); err == nil && n >= 1 && n <= len(recomendados) {
				if descargarOllama(c.Proveedor, recomendados[n-1].Nombre) == nil {
					c.Modelo = recomendados[n-1].Nombre
					return true
				}
			}
			continue
		case "o":
			nombre := leer("Nombre exacto del modelo: ")
			if nombre == "" {
				continue
			}
			if c.Proveedor.Ollama && !contiene(ms, nombre) && !contiene(ms, nombre+":latest") {
				if strings.ToLower(leer("No está en tu ordenador. ¿Descargarlo con Ollama? (S/n): ")) == "n" {
					continue
				}
				if descargarOllama(c.Proveedor, nombre) != nil {
					continue
				}
			}
			c.Modelo = nombre
			return true
		}
		var n int
		if _, err := fmt.Sscan(op, &n); err != nil || n < 1 || n > len(ms) {
			fmt.Println("✗ Opción no válida.")
			continue
		}
		c.Modelo = ms[n-1]
		return true
	}
}

func contiene(l []string, x string) bool {
	for _, y := range l {
		if y == x {
			return true
		}
	}
	return false
}

// descargarOllama descarga un modelo con la API de Ollama mostrando el progreso.
func descargarOllama(p Proveedor, nombre string) error {
	base := strings.TrimSuffix(strings.TrimRight(p.URL, "/"), "/v1")
	fmt.Printf("\nDescargando %s con Ollama… (puede tardar; no cierres esta ventana)\n", nombre)
	b, _ := json.Marshal(map[string]any{"model": nombre, "stream": true})
	res, err := cliente.Post(base+"/api/pull", "application/json", strings.NewReader(string(b)))
	if err != nil {
		fmt.Println("✗ Ollama no responde:", err)
		pausa("")
		return err
	}
	defer res.Body.Close()
	lector := bufio.NewScanner(res.Body)
	lector.Buffer(make([]byte, 64*1024), 1<<20)
	ultimo := ""
	for lector.Scan() {
		var e struct {
			Status    string `json:"status"`
			Total     int64  `json:"total"`
			Completed int64  `json:"completed"`
			Error     string `json:"error"`
		}
		if json.Unmarshal(lector.Bytes(), &e) != nil {
			continue
		}
		if e.Error != "" {
			fmt.Println("\n✗ Ollama:", e.Error)
			if strings.Contains(e.Error, "not found") || strings.Contains(e.Error, "does not exist") {
				fmt.Println("  Comprueba el nombre en https://ollama.com/library")
			}
			pausa("")
			return errors.New(e.Error)
		}
		linea := e.Status
		if e.Total > 0 {
			linea = fmt.Sprintf("%s  %5.1f%%  (%.2f de %.2f GB)", "descargando", float64(e.Completed)*100/float64(e.Total), float64(e.Completed)/1e9, float64(e.Total)/1e9)
		}
		if linea != ultimo {
			fmt.Printf("\r  %-60s", linea)
			ultimo = linea
		}
		if e.Status == "success" {
			fmt.Printf("\r  %-60s\n✓ %s descargado.\n", "listo", nombre)
			return nil
		}
	}
	fmt.Println("\n✗ La descarga se interrumpió. Vuelve a intentarlo.")
	pausa("")
	return errors.New("descarga interrumpida")
}

func pasoNombre(c *Config) {
	titulo("4/4 · Nombre público del nodo (opcional)")
	fmt.Println("Aparece en el chat como «respondió nodo LibreIA <nombre>». Sin tildes ni ñ (no se admiten).")
	actual := ""
	if c.Nombre != "" {
		actual = " [Enter = «" + c.Nombre + "»; un guion «-» = sin nombre]"
	}
	n := leer("Nombre" + actual + ": ")
	switch {
	case n == "" && c.Nombre != "":
	case n == "-":
		c.Nombre = ""
	default:
		n = strings.TrimSpace(reAlias.ReplaceAllString(sinTildes.Replace(n), ""))
		if len(n) > 24 {
			n = n[:24]
		}
		c.Nombre = n
	}
}

var sinTildes = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n", "Á", "A", "É", "E", "Í", "I", "Ó", "O", "Ú", "U", "Ü", "U", "Ñ", "N", "ç", "c", "Ç", "C")

func cuantos(n int) string {
	if n == 1 {
		return "1 modelo"
	}
	return fmt.Sprintf("%d modelos", n)
}

// probar hace al modelo una pregunta como la de control del servidor.
func probar(c Config) bool {
	fmt.Printf("\nProbando %s con una pregunta de control («¿Cuánto es 17 + 25?»)…\n", c.Modelo)
	inicio := time.Now()
	msgs, _ := json.Marshal([]map[string]string{{"role": "user", "content": "¿Cuánto es 17 + 25? Responde solo con el número."}})
	cero := 0.0
	texto, err := responder(c.Proveedor, c.Modelo, msgs, 400, &cero, 180*time.Second)
	if err != nil {
		fmt.Println("✗", err)
		return false
	}
	seg := time.Since(inicio).Seconds()
	corto := texto
	if len(corto) > 80 {
		corto = corto[:80] + "…"
	}
	if !regexp.MustCompile(`(^|\D)42(\D|$)`).MatchString(texto) {
		fmt.Printf("✗ Respondió «%s» (%.1f s). LibreIA espera 42: con este modelo el nodo no pasaría el control.\n", corto, seg)
		return false
	}
	fmt.Printf("✓ Respondió «%s» en %.1f s.\n", corto, seg)
	if seg > 40 {
		fmt.Println("! Es lento: las preguntas largas podrían pasar del límite de 60 s. Un modelo más pequeño irá mejor.")
	}
	return true
}

func asistente(c *Config) {
	fmt.Println("\nTe guío en 4 pasos. Al final se prueba el modelo y se conecta el nodo.")
	pasoToken(c)
	for {
		pasoProveedor(c)
		if pasoModelo(c) {
			break
		}
	}
	pasoNombre(c)
	for !probar(*c) {
		if strings.ToLower(leer("¿Elegir otro modelo? (S/n): ")) == "n" {
			break
		}
		pasoModelo(c)
	}
	if err := guardarConfig(*c); err != nil {
		fmt.Println("! No se pudo guardar la configuración:", err)
	} else {
		fmt.Println("✓ Configuración guardada en", rutaConfig())
	}
}

// ---------------------------------------------------------------- conexión con LibreIA

type pedido struct {
	Tipo        string          `json:"tipo"`
	ID          string          `json:"id"`
	Control     bool            `json:"control"`
	Mensajes    json.RawMessage `json:"mensajes"`
	MaxTokens   int             `json:"max_tokens"`
	Temperatura *float64        `json:"temperature"`
	Mensaje     string          `json:"mensaje"`
}

// errorFinal: LibreIA cerró la conexión por un motivo que no se arregla reconectando.
type errorFinal struct{ motivo string }

func (e errorFinal) Error() string { return e.motivo }

// conectar mantiene el nodo conectado hasta que ctx se cancela o LibreIA lo rechaza.
func conectar(ctx context.Context, c Config) error {
	servidor := c.Servidor
	if servidor == "" {
		servidor = servidorPorDefecto
	}
	var respondidas atomic.Int64
	espera := 2 * time.Second
	for ctx.Err() == nil {
		if _, err := modelos(c.Proveedor, 10*time.Second); err != nil {
			fmt.Printf("[%s] ✗ %s (%s) %s. Reintento en 30 s… (escribe M y Enter para cambiar la configuración)\n", hora(), c.Proveedor.Nombre, c.Proveedor.URL, err)
			if !dormir(ctx, 30*time.Second) {
				break
			}
			continue
		}
		inicio := time.Now()
		err := sesion(ctx, c, servidor, &respondidas)
		var fin errorFinal
		if errors.As(err, &fin) {
			return fin
		}
		if ctx.Err() != nil {
			break
		}
		if time.Since(inicio) > 2*time.Minute {
			espera = 2 * time.Second // estuvo conectado un rato: el fallo es nuevo
		}
		fmt.Printf("[%s] Conexión cerrada (%v). Reconectando en %d s…\n", hora(), err, int(espera.Seconds()))
		if !dormir(ctx, espera) {
			break
		}
		espera = min(espera*2, 120*time.Second)
	}
	return nil
}

func dormir(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

func sesion(ctx context.Context, c Config, servidor string, respondidas *atomic.Int64) error {
	dctx, cancelar := context.WithTimeout(ctx, 20*time.Second)
	ws, _, err := websocket.Dial(dctx, servidor, &websocket.DialOptions{HTTPHeader: http.Header{"User-Agent": {"LibreIA-Nodo/" + version}}})
	cancelar()
	if err != nil {
		return fmt.Errorf("no se pudo conectar con LibreIA: %v", err)
	}
	defer ws.CloseNow()
	ws.SetReadLimit(1 << 20)
	hola, _ := json.Marshal(map[string]any{"tipo": "hola", "token": c.Token, "modelos": []string{c.Modelo}, "nombre": c.Nombre, "version": "exe-" + version})
	if err := ws.Write(ctx, websocket.MessageText, hola); err != nil {
		return err
	}
	fmt.Printf("[%s] Conectado a LibreIA. Modelo: %s. Respondiendo la pregunta de control…\n", hora(), c.Modelo)
	// Latido: el texto «ping» lo contesta Cloudflare sin despertar al servidor (no un ping de control).
	lctx, pararLatido := context.WithCancel(ctx)
	defer pararLatido()
	go func() {
		t := time.NewTicker(25 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-lctx.Done():
				return
			case <-t.C:
				_ = ws.Write(lctx, websocket.MessageText, []byte("ping"))
			}
		}
	}()
	for {
		_, datos, err := ws.Read(ctx)
		if err != nil {
			codigo := websocket.CloseStatus(err)
			var ce websocket.CloseError
			motivo := ""
			if errors.As(err, &ce) {
				motivo = ce.Reason
			}
			// 4000: el mismo nodo se abrió en otro sitio; 4001-4004: token, bloqueo, límite o control.
			if codigo >= 4000 && codigo <= 4004 {
				if motivo == "" {
					motivo = fmt.Sprintf("código %d", codigo)
				}
				return errorFinal{motivo}
			}
			if codigo != -1 {
				return fmt.Errorf("código %d %s", codigo, motivo)
			}
			return err
		}
		if string(datos) == "pong" {
			continue
		}
		var m pedido
		if json.Unmarshal(datos, &m) != nil {
			continue
		}
		if m.Tipo == "activo" {
			fmt.Printf("[%s] ✓ %s\n", hora(), m.Mensaje)
			fmt.Println("   Deja esta ventana abierta mientras quieras prestar tu ordenador. Escribe M y Enter para el menú.")
			continue
		}
		if m.Tipo != "pedido" {
			continue
		}
		go func(m pedido) {
			inicio := time.Now()
			espera := 60 * time.Second
			if m.Control {
				espera = 110 * time.Second // la primera vez el modelo se carga en memoria
			}
			texto, err := responder(c.Proveedor, c.Modelo, m.Mensajes, m.MaxTokens, m.Temperatura, espera)
			var r []byte
			if err != nil {
				r, _ = json.Marshal(map[string]string{"tipo": "error", "id": m.ID, "error": recortar(err.Error(), 120)})
				fmt.Printf("[%s] ✗ No se pudo responder: %v\n", hora(), err)
			} else {
				r, _ = json.Marshal(map[string]string{"tipo": "respuesta", "id": m.ID, "texto": texto, "modelo": c.Modelo})
				if !m.Control {
					fmt.Printf("[%s] → respuesta enviada en %.1f s (total: %d)\n", hora(), time.Since(inicio).Seconds(), respondidas.Add(1))
				}
			}
			_ = ws.Write(ctx, websocket.MessageText, r)
		}(m)
	}
}

func recortar(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ---------------------------------------------------------------- menú

func resumen(c Config) {
	tok := "(sin token)"
	if reToken.MatchString(c.Token) {
		tok = c.Token[:8] + "… (guardado)"
	}
	nombre := c.Nombre
	if nombre == "" {
		nombre = "(anónimo)"
	}
	fmt.Printf("  Token: %s\n  Proveedor: %s (%s)\n  Modelo: %s\n  Nombre: %s\n", tok, c.Proveedor.Nombre, c.Proveedor.URL, c.Modelo, nombre)
}

func menu(c *Config) {
	for {
		titulo("LibreIA Nodo " + version)
		resumen(*c)
		fmt.Println("\n  1) Conectar el nodo")
		fmt.Println("  2) Configurar todo otra vez (asistente)")
		fmt.Println("  3) Cambiar solo el modelo")
		fmt.Println("  4) Cambiar solo el proveedor")
		fmt.Println("  5) Cambiar el token")
		if sistemaTieneInstalacion() {
			fmt.Printf("  6) Iniciar con Windows: %s\n", map[bool]string{true: "SÍ (pulsa para quitarlo)", false: "no (pulsa para activarlo)"}[inicioAutomatico()])
			fmt.Println("  7) Desinstalar de este ordenador")
		}
		fmt.Println("  0) Salir")
		switch leer("\nElige [Enter = 1]: ") {
		case "", "1":
			if !c.completa() {
				fmt.Println("✗ Falta configurar el nodo.")
				asistente(c)
				continue
			}
			ejecutar(c)
		case "2":
			asistente(c)
		case "3":
			if pasoModelo(c) {
				probar(*c)
				_ = guardarConfig(*c)
			}
		case "4":
			pasoProveedor(c)
			if pasoModelo(c) {
				probar(*c)
			}
			_ = guardarConfig(*c)
		case "5":
			pasoToken(c)
			_ = guardarConfig(*c)
		case "6":
			if sistemaTieneInstalacion() {
				if err := cambiarInicioAutomatico(!inicioAutomatico()); err != nil {
					fmt.Println("✗", err)
					pausa("")
				}
			}
		case "7":
			if sistemaTieneInstalacion() && strings.ToLower(leer("¿Desinstalar LibreIA Nodo de este ordenador? (s/N): ")) == "s" {
				if err := desinstalar(); err != nil {
					fmt.Println("✗", err)
					pausa("")
					continue
				}
				os.Exit(0)
			}
		case "0":
			os.Exit(0)
		}
	}
}

// ejecutar conecta el nodo hasta que la persona escribe M (menú) o LibreIA lo rechaza.
func ejecutar(c *Config) {
	titulo("Nodo en marcha")
	fmt.Println("Tus preguntas respondidas no se guardan ni se muestran aquí.")
	fmt.Println("Escribe M y Enter para volver al menú. Cerrar la ventana detiene el nodo.")
	ctx, cancelar := context.WithCancel(context.Background())
	hecho := make(chan error, 1)
	go func() { hecho <- conectar(ctx, *c) }()
	teclas := make(chan string, 1)
	go func() {
		for {
			l, err := entrada.ReadString('\n')
			if err != nil {
				return // sin consola (inicio automático): el nodo sigue hasta cerrar el proceso
			}
			teclas <- strings.ToLower(strings.TrimSpace(l))
		}
	}()
	for {
		select {
		case err := <-hecho:
			cancelar()
			if err != nil {
				fmt.Printf("\n[%s] ✗ LibreIA cerró la conexión: %v\n", hora(), err)
				if strings.Contains(err.Error(), "oken") {
					fmt.Println("  Genera un token nuevo en la app y elige «5) Cambiar el token».")
				} else if strings.Contains(err.Error(), "control") {
					fmt.Println("  Elige «3) Cambiar solo el modelo» y prueba uno más capaz.")
				}
				pausa("")
			}
			return
		case t := <-teclas:
			if t == "m" {
				cancelar()
				<-hecho
				return
			}
		}
	}
}

func main() {
	prepararConsola()
	token := flag.String("token", "", "token de nodo (modo sin asistente)")
	api := flag.String("api", "", "servidor local compatible con OpenAI")
	modelo := flag.String("modelo", "", "modelo a usar")
	nombre := flag.String("nombre", "", "nombre público del nodo")
	clave := flag.String("clave", "", "clave de tu servidor local, si la pide")
	servidor := flag.String("servidor", "", "")
	verMenu := flag.Bool("menu", false, "abrir el menú en vez de conectar")
	flag.Parse()

	fmt.Printf("LibreIA Nodo %s · presta tu ordenador a la comunidad de LibreIA\n", version)
	fmt.Println("Software libre (AGPL-3.0): https://github.com/humanx123/libreia/tree/main/nodo")

	// Modo sin asistente, compatible con libreia-nodo.mjs.
	if *token != "" {
		c := Config{Token: *token, Nombre: *nombre, Servidor: *servidor, Proveedor: Proveedor{Nombre: "servidor local", URL: strings.TrimRight(*api, "/"), Clave: *clave}}
		if c.Proveedor.URL == "" {
			c.Proveedor = conocidos[0]
			c.Proveedor.Clave = *clave
		}
		c.Modelo = *modelo
		if c.Modelo == "" {
			ms, err := modelos(c.Proveedor, 10*time.Second)
			if err != nil || len(ms) == 0 {
				fmt.Fprintf(os.Stderr, "✗ Tu servidor local (%s) %s.\n", c.Proveedor.URL, map[bool]string{true: "no tiene modelos", false: fmt.Sprint(err)}[err == nil])
				os.Exit(1)
			}
			c.Modelo = ms[0]
		}
		if !reToken.MatchString(c.Token) {
			fmt.Fprintln(os.Stderr, "✗ Token de nodo inválido.")
			os.Exit(1)
		}
		if err := conectar(context.Background(), c); err != nil {
			fmt.Fprintln(os.Stderr, "✗ LibreIA cerró la conexión:", err)
			os.Exit(2)
		}
		return
	}

	c := cargarConfig()
	if *servidor != "" {
		c.Servidor = *servidor
	}
	ofrecerInstalacion(&c)
	if !c.completa() {
		asistente(&c)
		if c.completa() && strings.ToLower(leer("\n¿Conectar el nodo ahora? (S/n): ")) != "n" {
			ejecutar(&c)
		}
	} else if !*verMenu {
		ejecutar(&c)
	}
	menu(&c)
}
