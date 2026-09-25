#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera os icones da extensao em PNG (RGBA), sem dependencias externas.

Uso: python tools/gerar_icones.py
"""

import struct
import zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / "public" / "icons"
TAMANHOS = (16, 32, 48, 128)
AMOSTRAS = 4  # superamostragem por eixo (suaviza as bordas)

FUNDO_TOPO = (79, 70, 229)     # indigo
FUNDO_BASE = (124, 58, 237)    # violeta
BRANCO = (255, 255, 255)
VERDE = (34, 197, 94)

CENTRO_LENTE = (52.0, 50.0)
RAIO_LENTE = 26.0
ESPESSURA_ANEL = 9.0
CABO_INICIO = (72.0, 72.0)
CABO_FIM = (98.0, 96.0)
ESPESSURA_CABO = 11.0
RAIO_PONTO = 9.0


def _misturar(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _distancia_ponto_segmento(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    comprimento2 = vx * vx + vy * vy
    t = 0.0 if comprimento2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / comprimento2))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return (dx * dx + dy * dy) ** 0.5


def _dentro_quadrado_arredondado(x, y, tamanho, raio):
    if raio <= 0:
        return 0 <= x <= tamanho and 0 <= y <= tamanho
    cx = min(max(x, raio), tamanho - raio)
    cy = min(max(y, raio), tamanho - raio)
    dx, dy = x - cx, y - cy
    return (dx * dx + dy * dy) <= raio * raio


def cor_do_ponto(x, y):
    """Cor RGBA (0-255, float) num ponto do espaco logico de 128 unidades."""
    if not _dentro_quadrado_arredondado(x, y, 128.0, 26.0):
        return (0.0, 0.0, 0.0, 0.0)
    t = max(0.0, min(1.0, y / 128.0))
    r, g, b = _misturar(FUNDO_TOPO, FUNDO_BASE, t)
    x0, y0 = CENTRO_LENTE
    distancia = ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5
    if abs(distancia - RAIO_LENTE) <= ESPESSURA_ANEL / 2:
        r, g, b = BRANCO
    elif distancia <= RAIO_PONTO:
        r, g, b = VERDE
    elif _distancia_ponto_segmento(x, y, CABO_INICIO[0], CABO_INICIO[1], CABO_FIM[0], CABO_FIM[1]) <= ESPESSURA_CABO / 2:
        r, g, b = BRANCO
    return (float(r), float(g), float(b), 255.0)


def renderizar(tamanho):
    linhas = []
    escala = 128.0 / tamanho
    total = AMOSTRAS * AMOSTRAS
    for py in range(tamanho):
        linha = bytearray()
        for px in range(tamanho):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(AMOSTRAS):
                for sx in range(AMOSTRAS):
                    x = (px + (sx + 0.5) / AMOSTRAS) * escala
                    y = (py + (sy + 0.5) / AMOSTRAS) * escala
                    amostra = cor_do_ponto(x, y)
                    for i in range(4):
                        acc[i] += amostra[i]
            linha.extend(int(round(acc[i] / total)) for i in range(4))
        linhas.append(bytes(linha))
    return linhas


def salvar_png(caminho, linhas):
    altura = len(linhas)
    largura = len(linhas[0]) // 4
    bruto = b"".join(b"\x00" + linha for linha in linhas)

    def bloco(tipo, dados):
        return (struct.pack(">I", len(dados)) + tipo + dados
                + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", largura, altura, 8, 6, 0, 0, 0)
    conteudo = (b"\x89PNG\r\n\x1a\n" + bloco(b"IHDR", ihdr)
                + bloco(b"IDAT", zlib.compress(bruto, 9)) + bloco(b"IEND", b""))
    caminho.write_bytes(conteudo)


def main():
    PASTA.mkdir(parents=True, exist_ok=True)
    for tamanho in TAMANHOS:
        caminho = PASTA / ("icon%d.png" % tamanho)
        salvar_png(caminho, renderizar(tamanho))
        print("ok: %s" % caminho.name)
    print("Icones gerados em %s" % PASTA)


if __name__ == "__main__":
    main()
