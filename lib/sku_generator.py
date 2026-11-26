"""
SKU Pattern Engine & Generator (Python Edition)
Principal Full-Stack Architecture - Inventory Subsystem

Capabilities:
1. Automatic pattern detection (prefix, delimiter, padding, sequencing)
2. Next-in-sequence generation (e.g. MOT-045 -> MOT-046)
3. In-between sub-variant branching (e.g. MOT-012 -> MOT-012A, MOT-012B)
4. Collision prevention and strict uniqueness validation
"""
import re
from typing import List, Dict, Any, Optional

class SkuPatternEngine:
    DELIMITERS = ['-', '/', '_', '.']

    @classmethod
    def parse_sku(cls, sku: str) -> Optional[Dict[str, Any]]:
        if not sku or not isinstance(sku, str):
            return None
        clean = sku.strip()

        match = re.match(r'^(.*?[-\/_.]?)(\d+)([A-Za-z]?)$', clean)
        if match:
            full_prefix = match.group(1)
            num_str = match.group(2)
            branch = match.group(3).upper() if match.group(3) else None

            delimiter = '-'
            clean_prefix = full_prefix
            for d in cls.DELIMITERS:
                if full_prefix.endswith(d):
                    delimiter = d
                    clean_prefix = full_prefix[:-1]
                    break

            return {
                'original': clean,
                'prefix': clean_prefix,
                'delimiter': delimiter,
                'sequence': int(num_str),
                'padding': len(num_str),
                'branch': branch
            }

        return {
            'original': clean,
            'prefix': clean,
            'delimiter': '-' if '-' in clean else '/',
            'sequence': None,
            'padding': 0,
            'branch': None
        }

    @classmethod
    def detect_pattern(cls, existing_skus: List[str], requested_prefix: str = '') -> Dict[str, Any]:
        if not existing_skus:
            prefix = re.sub(r'[^A-Z0-9]', '', requested_prefix.upper()) if requested_prefix else 'PROD'
            return {
                'prefix': prefix or 'PROD',
                'delimiter': '-',
                'padding': 3,
                'highestSeq': 0,
                'count': 0
            }

        parsed_list = []
        for s in existing_skus:
            raw = s if isinstance(s, str) else (s.get('sku') if isinstance(s, dict) else '')
            p = cls.parse_sku(raw)
            if p:
                parsed_list.append(p)

        prefix_counts: Dict[str, int] = {}
        padding_counts: Dict[int, int] = {}
        delimiter_counts: Dict[str, int] = {}
        highest_seq = 0

        for p in parsed_list:
            if p['sequence'] is not None:
                prefix_counts[p['prefix']] = prefix_counts.get(p['prefix'], 0) + 1
                padding_counts[p['padding']] = padding_counts.get(p['padding'], 0) + 1
                delimiter_counts[p['delimiter']] = delimiter_counts.get(p['delimiter'], 0) + 1
                if p['sequence'] > highest_seq:
                    highest_seq = p['sequence']

        dominant_prefix = requested_prefix
        if not dominant_prefix:
            if prefix_counts:
                dominant_prefix = sorted(prefix_counts.keys(), key=lambda k: prefix_counts[k], reverse=True)[0]
            else:
                dominant_prefix = 'SKU'

        dominant_padding = 3
        if padding_counts:
            dominant_padding = sorted(padding_counts.keys(), key=lambda k: padding_counts[k], reverse=True)[0]

        dominant_delimiter = '-'
        if delimiter_counts:
            dominant_delimiter = sorted(delimiter_counts.keys(), key=lambda k: delimiter_counts[k], reverse=True)[0]

        return {
            'prefix': dominant_prefix,
            'delimiter': dominant_delimiter,
            'padding': int(dominant_padding),
            'highestSeq': highest_seq,
            'totalAnalyzed': len(parsed_list)
        }

    @classmethod
    def format_seq(cls, num: int, padding: int) -> str:
        return str(num).zfill(padding)

    @classmethod
    def generate_next(cls, existing_skus: List[str] = None, prefix: str = '', custom_padding: Optional[int] = None) -> Dict[str, Any]:
        existing_skus = existing_skus or []
        pattern = cls.detect_pattern(existing_skus, prefix)
        padding = custom_padding or pattern.get('padding', 3)
        next_seq = pattern.get('highestSeq', 0) + 1

        candidate = f"{pattern['prefix']}{pattern['delimiter']}{cls.format_seq(next_seq, padding)}"

        existing_set = set(
            (s.strip().upper() if isinstance(s, str) else s.get('sku', '').strip().upper())
            for s in existing_skus if s
        )

        curr_seq = next_seq
        while candidate.upper() in existing_set:
            curr_seq += 1
            candidate = f"{pattern['prefix']}{pattern['delimiter']}{cls.format_seq(curr_seq, padding)}"

        return {
            'sku': candidate,
            'pattern': {
                'prefix': pattern['prefix'],
                'delimiter': pattern['delimiter'],
                'sequence': curr_seq,
                'padding': padding
            }
        }

    @classmethod
    def generate_sub_variant(cls, parent_sku: str, existing_skus: List[str] = None) -> Dict[str, Any]:
        existing_skus = existing_skus or []
        parsed = cls.parse_sku(parent_sku)
        if not parsed:
            raise ValueError(f"Cannot branch from invalid parent SKU: {parent_sku}")

        existing_set = set(
            (s.strip().upper() if isinstance(s, str) else s.get('sku', '').strip().upper())
            for s in existing_skus if s
        )

        if parsed['sequence'] is not None:
            base_padded = cls.format_seq(parsed['sequence'], parsed['padding'])
            base_code = f"{parsed['prefix']}{parsed['delimiter']}{base_padded}"
        else:
            base_code = parsed['original'] + '-'

        letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        for letter in letters:
            candidate = f"{base_code}{letter}"
            if candidate.upper() not in existing_set:
                return {
                    'sku': candidate,
                    'parentSku': parsed['original'],
                    'branchLetter': letter,
                    'pattern': {
                        'prefix': parsed['prefix'],
                        'sequence': parsed['sequence'],
                        'branch': letter
                    }
                }

        import time
        return {
            'sku': f"{base_code}A-{str(int(time.time()))[-4:]}",
            'parentSku': parsed['original'],
            'branchLetter': 'EXT'
        }
