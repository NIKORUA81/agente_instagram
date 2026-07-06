from app.core.chunking import chunk_text


def test_empty() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_short_text_single_chunk() -> None:
    chunks = chunk_text("Hola, este es un texto corto.", max_chars=1000)
    assert len(chunks) == 1
    assert "texto corto" in chunks[0]


def test_long_text_splits() -> None:
    para = "Frase de prueba número {}. ".format
    text = "\n\n".join(para(i) * 20 for i in range(6))
    chunks = chunk_text(text, max_chars=300, overlap=40)
    assert len(chunks) > 1
    assert all(len(c) <= 400 for c in chunks)  # margen por solapamiento


def test_respects_paragraphs() -> None:
    text = "Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres."
    chunks = chunk_text(text, max_chars=1000)
    assert len(chunks) == 1
    assert "Párrafo uno" in chunks[0]
    assert "Párrafo tres" in chunks[0]
