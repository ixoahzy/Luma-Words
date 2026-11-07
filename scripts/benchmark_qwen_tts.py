"""Benchmark official 0.6B Serena locally, before enabling it in the website."""
import os
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
from pathlib import Path
import json,time,threading,platform
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'qwen-tts'; OUT.mkdir(parents=True,exist_ok=True)
os.environ.setdefault('HF_HOME',str(ROOT/'.tts-cache'))
import psutil
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel
process=psutil.Process()
report={'hardware':{'machine':platform.machine(),'ram_gib':psutil.virtual_memory().total/2**30},'engine':'official qwen-tts / PyTorch MPS','dtype':'bfloat16','speaker':'Serena','samples':[]}
report.update(json.loads((OUT/'model-source.json').read_text()))
def save(): (OUT/'benchmark.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
assert torch.backends.mps.is_available(), 'MPS GPU is not available'
peak=[0]; done=threading.Event()
def sample_memory():
    while not done.wait(.1): peak[0]=max(peak[0],process.memory_info().rss)
threading.Thread(target=sample_memory,daemon=True).start()
try:
    start=time.perf_counter()
    model=Qwen3TTSModel.from_pretrained(str(ROOT/'.tts-models'/'qwen3-0.6b-customvoice'),device_map='mps',dtype=torch.bfloat16,attn_implementation='sdpa')
    torch.mps.synchronize()
    report['load_seconds']=time.perf_counter()-start
    report['rss_after_load_gib']=process.memory_info().rss/2**30
    report['gpu_driver_after_load_gib']=torch.mps.driver_allocated_memory()/2**30
    save();print('Loaded:',round(report['load_seconds'],2),'seconds',flush=True)
    for name,lang,text in [
        ('zh','Chinese','你好，我是 lion。我们一起练习英语吧，你今天过得怎么样？'),
        ('en','English',"Hi, I'm lion. What do you like to do on weekends?"),
        ('mixed','Auto',"今天我们练习点餐。I'd like a cup of coffee, please. 你想点些什么？")]:
        peak[0]=process.memory_info().rss
        torch.manual_seed(42)
        start=time.perf_counter();print('Generating',name,flush=True)
        wavs,sr=model.generate_custom_voice(text=text,language=lang,speaker='Serena',max_new_tokens=1024)
        torch.mps.synchronize();elapsed=time.perf_counter()-start
        path=OUT/f'serena-{name}.wav';sf.write(path,wavs[0],sr)
        row={'name':name,'language':lang,'text':text,'file':path.name,'sample_rate':sr,'audio_seconds':len(wavs[0])/sr,'generation_seconds':elapsed,'peak_rss_gib':peak[0]/2**30,'gpu_driver_gib':torch.mps.driver_allocated_memory()/2**30}
        row['rtf']=elapsed/row['audio_seconds'];report['samples'].append(row);save();print(json.dumps(row,ensure_ascii=False),flush=True)
except Exception as error:
    report['error']=str(error);save();raise
finally: done.set()
