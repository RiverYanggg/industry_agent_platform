"""TF-IDF retrieval over project knowledge chunks."""
from __future__ import annotations

from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer

from server.db import fetch_all


def search_project_knowledge(project_id: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT kc.id, kc.content, kc.chunk_index, kd.filename, kd.stored_path, kd.id AS doc_id
        FROM knowledge_chunks kc
        JOIN knowledge_docs kd ON kc.doc_id = kd.id
        WHERE kc.project_id = ?
        """,
        (project_id,),
    )
    if not rows:
        return []

    texts = [row["content"] for row in rows]
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
    matrix = vectorizer.fit_transform(texts + [query])
    query_vector = matrix[-1]
    scores = (matrix[:-1] @ query_vector.T).toarray().ravel()
    indexed = sorted(enumerate(scores.tolist()), key=lambda item: item[1], reverse=True)[:limit]
    return [
        {
            "citation": f"S{rank + 1}",
            "doc_id": rows[index]["doc_id"],
            "filename": rows[index]["filename"],
            "chunk_index": rows[index]["chunk_index"],
            "score": round(score, 4),
            "content": rows[index]["content"],
            "download_url": f"/files/{rows[index]['stored_path']}",
        }
        for rank, (index, score) in enumerate(indexed)
        if score > 0
    ]
