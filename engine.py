"""Cell detection and export for the local hemocytometer web application.
All pixel coordinates refer to the original image (not its browser preview).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import zipfile
from pathlib import Path

import cv2
import numpy as np

LETTERS = "ABCD"
THICK = {
    "A": ("right", "bottom"),
    "B": ("left", "bottom"),
    "C": ("left", "top"),
    "D": ("right", "top"),
}
EXTENSIONS = {".tif", ".tiff", ".png", ".jpg", ".jpeg", ".bmp", ".webp"}


def decode_image(blob: bytes) -> np.ndarray:
    im = cv2.imdecode(np.frombuffer(blob, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise ValueError("画像を開けません。TIFF/PNG/JPEG/BMPを確認してください。")
    if im.dtype != np.uint8:
        v = im.astype(np.float32)
        lo, hi = float(np.nanpercentile(v, 0.2)), float(np.nanpercentile(v, 99.8))
        im = np.clip((v-lo)*255.0/max(hi-lo,1), 0, 255).astype(np.uint8)
    if im.ndim == 2:
        return cv2.cvtColor(im,cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 4:
        return cv2.cvtColor(im,cv2.COLOR_BGRA2BGR)
    if im.shape[2] == 3:
        return im
    raise ValueError("対応していない画像のチャンネル数です。")


def make_preview(bgr: np.ndarray, max_width: int=2000, max_height: int=1550) -> bytes:
    h,w=bgr.shape[:2]
    scale=min(1.0, max_width/w, max_height/h)
    small=cv2.resize(bgr,(round(w*scale),round(h*scale)),interpolation=cv2.INTER_AREA) if scale<1 else bgr
    ok, encoded = cv2.imencode('.jpg',small,[cv2.IMWRITE_JPEG_QUALITY,86])
    if not ok: raise ValueError("画像プレビューを作成できません。")
    return encoded.tobytes()


def normalize_roi(roi, w: int, h: int):
    if not isinstance(roi,(list,tuple)) or len(roi)!=4:
        raise ValueError("計数範囲(ROI)を4つの座標で指定してください。")
    x0,y0,x1,y1=map(lambda x:int(round(float(x))),roi)
    x0,x1=sorted((x0,x1));y0,y1=sorted((y0,y1))
    if x0<0 or y0<0 or x1>=w or y1>=h or x1-x0<20 or y1-y0<20:
        raise ValueError("ROIが画像の外にあるか、小さすぎます。")
    return [x0,y0,x1,y1]


def roi_overlap(box,roi) -> bool:
    left, top, right, bottom = box
    x0,y0,x1,y1=roi
    return left<=x1 and right>=x0 and top<=y1 and bottom>=y0


def thick_touch(box, roi, letter: str, thick_sides=None) -> bool:
    """The 1-mm boundary is the middle of the grid line, not its inner edge."""
    left,top,right,bottom=box
    x0,y0,x1,y1=roi
    tol=max(2,round(min(x1-x0,y1-y0)*.003))
    thick=THICK[letter] if thick_sides is None else tuple(thick_sides)
    return (("left" in thick and left<=x0+tol<=right)
         or ("right" in thick and left<=x1-tol<=right)
         or ("top" in thick and top<=y0+tol<=bottom)
         or ("bottom" in thick and top<=y1-tol<=bottom))


def detect_cells(img: np.ndarray, roi, letter: str, mode: str='purple',
                 threshold=18, min_area=55, max_area=2000, estimate_multi=False, thick_sides=None):
    """Conservative connected-component detector, point candidates only."""
    if letter not in THICK:
        raise ValueError("区画名はA〜Dを指定してください。")
    h,w=img.shape[:2]
    roi=normalize_roi(roi,w,h)
    x0,y0,x1,y1=roi
    pad=max(14,round(min(x1-x0,y1-y0)*.07))
    cx0,cy0=max(0,x0-pad),max(0,y0-pad)
    cx1,cy1=min(w,x1+pad),min(h,y1+pad)
    sub=img[cy0:cy1,cx0:cx1]
    threshold=float(threshold)
    min_area=int(min_area);max_area=int(max_area)
    if not 1<=min_area<=max_area<=1_000_000:
        raise ValueError("細胞面積の設定が正しくありません。")
    if mode=='purple':
        b=sub[:,:,0].astype(np.float32)
        g=sub[:,:,1].astype(np.float32)
        score=cv2.GaussianBlur(b-g,(3,3),0)
        mask=(score>threshold).astype(np.uint8)*255
    elif mode in ('dark','bright'):
        gray=cv2.cvtColor(sub,cv2.COLOR_BGR2GRAY)
        gray=cv2.GaussianBlur(gray,(3,3),0)
        clahe=cv2.createCLAHE(clipLimit=1.5,tileGridSize=(8,8))
        gray=clahe.apply(gray)
        block=max(15,min(81,(round(min(x1-x0,y1-y0)*.09)|1)))
        flag=cv2.THRESH_BINARY_INV if mode=='dark' else cv2.THRESH_BINARY
        c=int(np.clip(threshold/2,0,35)) if mode=='dark' else -int(np.clip(threshold/2,0,35))
        mask=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,flag,block,c)
        # Subtract long straight grid lines. This can clip cells touching grid lines.
        hx=cv2.morphologyEx(mask,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(15,(x1-x0)//5),1)))
        vy=cv2.morphologyEx(mask,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(15,(y1-y0)//5))))
        mask=cv2.subtract(mask,cv2.bitwise_or(hx,vy))
    else:
        raise ValueError("検出モードが不明です。")
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
    n, labels, stats, cents=cv2.connectedComponentsWithStats(mask,8)
    eligible=[int(stats[i,cv2.CC_STAT_AREA]) for i in range(1,n)
              if min_area<=stats[i,cv2.CC_STAT_AREA]<=max_area]
    single_area=float(np.median(eligible)) if eligible else float(min_area*4)
    found=[]
    for i in range(1,n):
        xx,yy,ww,hh,area=map(int,stats[i])
        if not(min_area<=area<=max_area) or ww<3 or hh<3 or max(ww,hh)/max(1,min(ww,hh))>15:
            continue
        bbox=[xx+cx0, yy+cy0, xx+ww-1+cx0, yy+hh-1+cy0]
        if not roi_overlap(bbox,roi):
            continue
        mult=max(1,min(8,int(round(area/max(single_area,1))))) if estimate_multi else 1
        found.append(dict(x=round(float(cents[i,0]+cx0),2),y=round(float(cents[i,1]+cy0),2),
                          mult=mult, included=not thick_touch(bbox,roi,letter,thick_sides),
                          source='auto', bbox=bbox, area=area))
    return found


def count_points(points):
    return sum(int(p.get('mult',1)) for p in points if p.get('included',True))


def previous_match(name, sha256, previous):
    old=previous.get(name)
    if not old or old['sha256']!=sha256: return None
    return dict(letter=old['letter'],roi=old['roi'],
                points=[dict(x=float(x),y=float(y),mult=int(mult),included=True,source='previous',bbox=None,area=0)
                        for x,y,mult in old['points']])


def _csv_bytes(rows, fields):
    f=io.StringIO(newline='')
    f.write('\ufeff')  # Excel UTF-8 BOM
    wr=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore')
    wr.writeheader();wr.writerows(rows)
    return f.getvalue().encode('utf-8')


def annotated_roi(img, roi, letter, points, thick_sides=None):
    x0,y0,x1,y1=roi
    h,w=img.shape[:2];pad=36
    bx0=max(0,x0-pad);by0=max(0,y0-pad);bx1=min(w,x1+pad);by1=min(h,y1+pad)
    crop=img[by0:by1,bx0:bx1].copy()
    # Blue/cyan = include; red = exclude; grid lines through the ROI's edges.
    thick=set(THICK[letter] if thick_sides is None else thick_sides)
    cols={'thin':(255,220,0),'thick':(70,70,250)}
    for side, a, b in [
        ('left',(x0-bx0,y0-by0),(x0-bx0,y1-by0)),
        ('right',(x1-bx0,y0-by0),(x1-bx0,y1-by0)),
        ('top',(x0-bx0,y0-by0),(x1-bx0,y0-by0)),
        ('bottom',(x0-bx0,y1-by0),(x1-bx0,y1-by0))]:
        cv2.line(crop,a,b,cols['thick' if side in thick else 'thin'],3)
    for p in points:
        x=int(round(float(p['x'])))-bx0;y=int(round(float(p['y'])))-by0
        if not(-15<=x<crop.shape[1]+15 and -15<=y<crop.shape[0]+15):continue
        color=(80,230,90) if p.get('included',True) else (90,70,250)
        if p.get('source')=='manual' and p.get('included',True): color=(240,205,30)
        cv2.circle(crop,(x,y),7,color,2)
        if not p.get('included',True):
            cv2.line(crop,(x-5,y-5),(x+5,y+5),color,2)
            cv2.line(crop,(x-5,y+5),(x+5,y-5),color,2)
        if int(p.get('mult',1))>1:
            cv2.putText(crop,str(int(p['mult'])),(x+9,y-7),cv2.FONT_HERSHEY_SIMPLEX,.55,(0,120,255),2,cv2.LINE_AA)
    ok, encoded=cv2.imencode('.png',crop)
    if not ok: raise ValueError("注釈画像を作成できませんでした。")
    return encoded.tobytes()


def export_archive(session, images):
    """Return downloadable zip with CSV, annotated ROI images, and a resumable JSON."""
    quarters=session.get('quarters') or {}
    dilution=float(session.get('dilution',1))
    if not math.isfinite(dilution) or dilution<=0:
        raise ValueError("希釈倍率は0より大きい値にしてください。")
    summary=[]; points_rows=[]; total=0; ready=True; confirmed=True
    pictures={}
    for letter in LETTERS:
        st=quarters.get(letter,{})
        image_id=st.get('imageId');image=images.get(image_id)
        roi=st.get('roi');points=st.get('points',[])
        if not isinstance(points,list): raise ValueError("細胞点データが不正です。")
        valid=bool(image is not None and roi is not None)
        if valid: roi=normalize_roi(roi,image['img'].shape[1],image['img'].shape[0])
        n=count_points(points) if valid else None
        total+=(n or 0)
        ready &=valid
        confirmed &=bool(st.get('confirmed',False))
        summary.append(dict(quarter=letter,filename=image['name'] if image else '',
            count=n if n is not None else '',confirmed=bool(st.get('confirmed',False)),
            roi_x0=roi[0] if valid else '',roi_y0=roi[1] if valid else '',
            roi_x1=roi[2] if valid else '',roi_y1=roi[3] if valid else '',
            thick_borders='+'.join(st.get('thickSides') or THICK[letter])))
        if valid:
            for i,p in enumerate(points,1):
                points_rows.append(dict(quarter=letter,filename=image['name'],index=i,x=p.get('x'),y=p.get('y'),
                    multiplicity=p.get('mult',1),included=p.get('included',True),source=p.get('source',''),
                    area=p.get('area',0)))
            pictures[f'annotated_{letter}.png']=annotated_roi(image['img'],roi,letter,points,st.get('thickSides'))
    concentration=total/4*10000*dilution if ready else None
    bio=io.BytesIO()
    with zipfile.ZipFile(bio,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        z.writestr('summary.csv',_csv_bytes(summary,['quarter','filename','count','confirmed','roi_x0','roi_y0','roi_x1','roi_y1','thick_borders']))
        z.writestr('points.csv',_csv_bytes(points_rows,['quarter','filename','index','x','y','multiplicity','included','source','area']))
        z.writestr('result.json',json.dumps(dict(total=total if ready else None,
            mean_per_square=total/4 if ready else None,
            concentration_cells_per_mL=concentration,dilution=dilution,
            all_four_areas_defined=bool(ready),all_visually_confirmed=bool(confirmed)),ensure_ascii=False,indent=2))
        clean_session={'version':1,'dilution':dilution,'quarters':{},'image_manifest':[]}
        for key,meta in images.items():
            clean_session['image_manifest'].append(dict(id=key,name=meta['name'],sha256=meta['sha256'],width=meta['img'].shape[1],height=meta['img'].shape[0]))
        for letter in LETTERS:
            st=quarters.get(letter,{})
            meta=images.get(st.get('imageId'))
            clean_session['quarters'][letter]={
                'imageName':meta['name'] if meta else None,
                'imageSha256':meta['sha256'] if meta else None,
                'roi':st.get('roi'),'points':st.get('points',[]),'confirmed':bool(st.get('confirmed',False)),
                'thickSides':st.get('thickSides') or list(THICK[letter])}
        z.writestr('session.json',json.dumps(clean_session,ensure_ascii=False,indent=2))
        z.writestr('README.txt',('Hemocytometer 4-square count (local app)\n'
        'Each square 1 mm x 1 mm x 0.1 mm = 1e-4 mL.\n'
        'Thick-border touching cells are excluded; thin-border touching cells included.\n'
        'Cells/mL = (total count / 4) * 1e4 * dilution.\n'
        'The reported density is only valid with all four square regions defined.\n'
        'ALL results are candidates until visually checked.\n'
        'Session.json does not contain the original images; upload them again before resuming.\n'))
        for name,b in pictures.items(): z.writestr(name,b)
    return bio.getvalue()
