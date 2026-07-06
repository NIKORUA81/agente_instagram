import pytest

from app.core.llm import parse_json_object


def test_plain_json() -> None:
    assert parse_json_object('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}


def test_fenced_json() -> None:
    raw = '```json\n{"reply": "hola", "handover": false}\n```'
    assert parse_json_object(raw) == {"reply": "hola", "handover": False}


def test_json_with_surrounding_text() -> None:
    raw = 'Claro, aquí tienes:\n{"intent": "precio"}\nEspero que ayude.'
    assert parse_json_object(raw) == {"intent": "precio"}


def test_no_json_raises() -> None:
    with pytest.raises(ValueError):
        parse_json_object("no hay json aquí")
