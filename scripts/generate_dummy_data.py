"""Generate deterministic, offline synthetic cyclone imagery and records."""
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
IMAGES = DATA / "cyclone_images"
SIZE = 420

EVENTS = [
    {"id":"CYCLONE-001","name":"Synthetic Cyclone 001","basin":"Bay of Bengal","region":"Odisha coast","start":"2026-09-28T00:00:00Z","lat":13.0,"lon":88.0,"dlat":0.46,"dlon":-0.18,"wind":58,"wind_gain":6.8,"pressure":1000,"sst":29.1,"temp":27.6,"humidity":76,"rain":18,"direction":"NNW","movement":18.4},
    {"id":"CYCLONE-002","name":"Synthetic Cyclone 002","basin":"Arabian Sea","region":"Gujarat coast","start":"2026-09-28T00:00:00Z","lat":17.4,"lon":70.5,"dlat":0.18,"dlon":-0.47,"wind":104,"wind_gain":4.6,"pressure":982,"sst":28.4,"temp":26.9,"humidity":83,"rain":32,"direction":"WNW","movement":22.1},
    {"id":"CYCLONE-003","name":"Synthetic Cyclone 003","basin":"Bay of Bengal","region":"Andhra Pradesh coast","start":"2026-09-28T00:00:00Z","lat":12.2,"lon":85.6,"dlat":0.34,"dlon":-0.11,"wind":142,"wind_gain":1.8,"pressure":955,"sst":29.4,"temp":27.1,"humidity":89,"rain":54,"direction":"NNW","movement":14.7},
    {"id":"CYCLONE-004","name":"Synthetic Cyclone 004","basin":"Arabian Sea","region":"Gujarat coast","start":"2026-09-28T00:00:00Z","lat":20.1,"lon":68.0,"dlat":0.20,"dlon":-0.30,"wind":78,"wind_gain":3.2,"pressure":991,"sst":28.7,"temp":27.3,"humidity":81,"rain":25,"direction":"WNW","movement":16.3},
    {"id":"CYCLONE-005","name":"Synthetic Cyclone 005","basin":"South Bay of Bengal","region":"Tamil Nadu coast","start":"2026-09-28T00:00:00Z","lat":9.4,"lon":84.8,"dlat":0.16,"dlon":-0.39,"wind":46,"wind_gain":5.1,"pressure":1005,"sst":29.7,"temp":28.0,"humidity":73,"rain":14,"direction":"WNW","movement":20.6},
]


def intensity(wind):
    if wind < 31: return "Depression"
    if wind < 50: return "Deep Depression"
    if wind < 62: return "Tropical Storm"
    if wind <= 88: return "Cyclonic Storm"
    if wind <= 117: return "Severe Cyclonic Storm"
    if wind <= 165: return "Very Severe Cyclonic Storm"
    return "Extremely Severe Cyclonic Storm"


def make_satellite(path, seed, strength, frame, motion=(.3,-.2)):
    """Procedural infrared-like cloud field with a spiral, eye and evolving convection."""
    rng = np.random.default_rng(seed)
    magnitude=max(abs(motion[0]),abs(motion[1]),.01)
    cx = SIZE * (.5 + motion[1]/magnitude*frame*.016 + .005*math.sin(frame*.73))
    cy = SIZE * (.5 - motion[0]/magnitude*frame*.012 + .005*math.cos(frame*.61))
    rotation = frame * .29 + rng.random() * .08
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    dx, dy = xx-cx, yy-cy
    radius, theta = np.hypot(dx,dy), np.arctan2(dy,dx)
    radius_scale = 55 + strength * .62
    phase = theta - radius / radius_scale * 2.8 + rotation
    band = np.sin(phase * 2.25 + .7 * np.sin(phase * .7))
    eye = np.maximum(0, 1-radius/(10+strength*.055))
    eyewall=np.exp(-((radius-(17+strength*.05))/(5+strength*.015))**2)
    outer=np.exp(-((radius-radius_scale*.69)/(radius_scale*.34))**2)
    convective=np.maximum(0,band-.08)**1.25*(.82*eyewall+.66*outer)
    feeder=np.maximum(0,np.sin(theta*4.2+radius/22-rotation))**3*np.exp(-((radius-radius_scale*.84)/(radius_scale*.36))**2)*.5
    cloud=np.clip((convective+feeder)*1.25+rng.uniform(-.025,.025,(SIZE,SIZE)),0,1)*(1-eye*.93)
    sea=.035+.015*np.sin(xx*.035+yy*.023)
    pixels=np.stack((5+cloud*155,19+cloud*183,35+cloud*199),axis=2).astype(np.uint8)
    mask=cloud<.03
    pixels[mask]=np.stack((5+sea[mask]*35,18+sea[mask]*42,31+sea[mask]*58),axis=1).astype(np.uint8)
    image=Image.fromarray(pixels,"RGB")
    image = image.filter(ImageFilter.GaussianBlur(.45))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((cx-4, cy-4, cx+4, cy+4), fill=(3, 13, 23, 220), outline=(192, 229, 236, 160), width=2)
    draw.text((13, 12), "SYNTHETIC IR  /  DEMO", fill=(190, 215, 220, 210))
    draw.text((13, SIZE-25), f"T+{frame*6:02d}H   6.0 UM", fill=(153, 184, 195, 210))
    image.save(path, optimize=True)


def main():
    IMAGES.mkdir(parents=True, exist_ok=True)
    rows, event_records, tracks, predictions = [], [], {}, {}
    for ci, event in enumerate(EVENTS):
        start = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
        observations = []
        for frame in range(8):
            timestamp = (start + timedelta(hours=6*frame)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            wind = round(event["wind"] + event["wind_gain"]*frame + 1.8*math.sin(frame*.8), 1)
            pressure = round(event["pressure"] - event["wind_gain"]*1.03*frame + 1.4*math.cos(frame*.75), 1)
            lat = round(event["lat"] + event["dlat"]*frame + .025*math.sin(frame*.6+ci), 3)
            lon = round(event["lon"] + event["dlon"]*frame + .025*math.cos(frame*.5+ci), 3)
            image_name = f"cyclone_{ci+1:03d}_t{frame*6:02d}.png"
            image_rel = f"data/cyclone_images/{image_name}"
            make_satellite(IMAGES / image_name, ci*997 + frame*43, wind, frame,(event["dlat"],event["dlon"]))
            obs = {"cyclone_id":event["id"],"timestamp":timestamp,"image_path":image_rel,"latitude":lat,"longitude":lon,"wind_speed":wind,"central_pressure":pressure,"temperature":round(event["temp"]-.04*frame,1),"humidity":min(98,round(event["humidity"]+.65*frame,1)),"sea_surface_temperature":round(event["sst"]-.035*frame,1),"cloud_top_temperature":round(-42-wind*.18-frame*.8,1),"rainfall":round(event["rain"]+frame*2.4,1),"movement_speed":round(event["movement"]+.7*math.sin(frame*.4),1),"movement_direction":event["direction"],"intensity_class":intensity(wind)}
            observations.append(obs); rows.append(obs)
        hist = [{"timestamp":o["timestamp"],"latitude":o["latitude"],"longitude":o["longitude"],"wind_speed":o["wind_speed"],"intensity":o["intensity_class"]} for o in observations]
        last = observations[-1]
        forecasts=[]
        for hours in (6,12,24,48):
            t=hours/6
            lat=last["latitude"]+event["dlat"]*t+.008*t*t
            lon=last["longitude"]+event["dlon"]*t-.004*t*t
            fw=round(max(25,last["wind_speed"]+event["wind_gain"]*min(t,4)-.25*max(0,t-4)),1)
            forecasts.append({"hours":hours,"timestamp":(datetime.fromisoformat(last["timestamp"].replace("Z","+00:00"))+timedelta(hours=hours)).isoformat().replace("+00:00","Z"),"latitude":round(lat,3),"longitude":round(lon,3),"wind_speed":fw,"central_pressure":round(last["central_pressure"]-event["wind_gain"]*min(t,4)*1.03,1),"intensity_class":intensity(fw),"confidence":round(max(.55,.94-hours*.0068),2)})
        tracks[event["id"]]=hist
        predictions[event["id"]]={"current_position":{"latitude":last["latitude"],"longitude":last["longitude"]},"predicted_path":forecasts}
        event_records.append({"id":event["id"],"name":event["name"],"basin":event["basin"],"region":event["region"],"data_label":"DEMO / SYNTHETIC DATA","observation_count":len(observations),"observations":observations})
    with (DATA/"cyclone_dataset.csv").open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    for name,value in (("cyclone_events.json",event_records),("cyclone_tracks.json",tracks),("cyclone_predictions.json",predictions)):
        (DATA/name).write_text(json.dumps(value,indent=2),encoding="utf-8")
    print(f"Generated {len(event_records)} events, {len(rows)} observations, {len(rows)} PNG images in {DATA}")


if __name__ == "__main__": main()
