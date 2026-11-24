import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import (THICK, count_points, detect_cells, export_archive, normalize_roi, thick_touch)


class EngineTests(unittest.TestCase):
    def test_thick_border_inclusion(self):
        roi=[30,30,180,180]
        self.assertTrue(thick_touch([175,80,185,90],roi,'A'))
        self.assertTrue(thick_touch([70,175,85,185],roi,'A'))
        self.assertFalse(thick_touch([25,80,35,90],roi,'A'))
        self.assertFalse(thick_touch([70,25,85,35],roi,'A'))
        self.assertTrue(thick_touch([25,80,35,90],roi,'A',['left','top']))
    def test_synthetic_detector(self):
        im=np.full((230,230,3),180,dtype=np.uint8)
        centers=[(70,70),(95,115),(140,140),(180,90)]
        for c in centers:
            cv2.circle(im,c,5,(240,80,130),-1)
        pts=detect_cells(im,[30,30,180,180],'A',threshold=20,min_area=20,max_area=500)
        self.assertEqual(len(pts),4)
        self.assertEqual(count_points(pts),3) # right border excluded
    def test_export_zip(self):
        im=np.full((250,250,3),160,dtype=np.uint8)
        images={k:{'name':k+'.png','sha256':k*12,'img':im} for k in THICK}
        quarters={k:{'imageId':k,'roi':[30,30,180,180],
            'points':[{'x':90,'y':90,'mult':2,'included':True,'source':'manual'}],
            'thickSides':list(THICK[k]),'confirmed':True} for k in THICK}
        data=export_archive({'quarters':quarters,'dilution':3},images)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(json.loads(z.read('result.json'))['concentration_cells_per_mL'],60000)
            self.assertEqual(len([n for n in z.namelist() if n.endswith('.png')]),4)
            self.assertIn('thick_borders',z.read('summary.csv').decode('utf-8-sig'))
            self.assertEqual(json.loads(z.read('session.json'))['quarters']['A']['thickSides'],list(THICK['A']))
    def test_previous_counts(self):
        from engine import previous_match
        history={'image.tif': {'sha256':'abc', 'letter':'A', 'roi':[10,10,200,200], 'points':[[100,100,2]]}}
        m=previous_match('image.tif','abc',history)
        self.assertEqual(m['letter'],'A')
        self.assertEqual(m['points'][0]['mult'],2)
        self.assertIsNone(previous_match('image.tif','other-hash',history))


if __name__=='__main__': unittest.main()
