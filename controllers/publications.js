'use strict'

//filesystem y path de node
var fs = require('fs');
var path = require('path');

var mongoose_pagination = require('mongoose-pagination');
var moment = require('moment');

var Publications = require('../models/publications');
var User = require('../models/users');
var Follow = require('../models/follow');

function test(req, res){
    return res.status(200).send({ message: 'controlador publications success'});
}

//guardar publicacion
function savePublication(req, res){
    var params = req.body;

    if(!params.text){
        return res.status(200).send({ message: 'El campo de texto es necesario!'});
    }

    var publication = new Publications;
    publication.text = params.text;
    publication.user = req.user.sub;
    publication.created_at = moment().unix();
    publication.file = null;

    publication.save((err, publicationSaved)=>{
        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
        if(!publicationSaved) return res.status(404).send({ message: 'Error al intentar guardar la publicacion'});

        return res.status(200).send({ publication: publicationSaved }); 
    });
}

//obtener publicaciones de usuarios que el usuario autenticado sigue
function getPublicationsTimeline(req, res){
    var page = 1;
    var userId = req.user.sub;

    if(req.params.page){
        page = req.params.page;
    }

    var itemsPerPage = 4;

    //seguidores de usuario autenticado
    Follow.find({user: userId}).exec((err, follows)=>{
        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
        if(!follows) return res.status(404).send({ message: 'No se ha podido obtener seguimiento de usuarios'});

        var follows_clean = [];
        follows.forEach(follow => {
            follows_clean.push(follow.followed);
        });

        follows_clean.push(userId); //añado el id del aut. para que muestre sus publicaciones tambien

        //busca publicaciones de usuarios que sigue el autenticado, ordenado por fecha
        Publications.find({user: {'$in': follows_clean}}).sort('-created_at').populate('user').paginate(page, itemsPerPage, (err, publications, total)=>{
            if(err) return res.status(500).send({ message: 'Error interno del servidor'});
            if(!publications) return res.status(404).send({ message: 'No se ha podido obtener publicaciones de usuarios'});

            return res.status(200).send({ 
                total,
                pages: Math.ceil(total/itemsPerPage),
                page: page,
                publications
            });
        });

    });

}

//obtener una publicacion especificada
function getPublication(req, res){
    var publicationId = req.params.id;

    Publications.findById(publicationId, (err, publication)=>{
        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
        if(!publication) return res.status(404).send({ message: 'No se ha podido obtener la publicacion especificada'});    

        return res.status(200).send({ publication });
    });
}

//obtener publicaciones de usuario
function getPublicationUser(req, res){
    var page = 1;
    var userId = req.user.sub;

    if(req.params.page){
        page = req.params.page;
    }

    if(req.params.user){
        userId = req.params.user;
    }

    let itemsPerPage = 4;
        //busca publicaciones de usuarios que sigue el autenticado, ordenado por fecha
        Publications.find({user: userId}).sort('-created_at').populate('user').paginate(page, itemsPerPage, (err, publications, total)=>{
            if(err) return res.status(500).send({ message: 'Error interno del servidor'});
            if(!publications) return res.status(404).send({ message: 'No se ha podido obtener publicaciones del usuario'});

            return res.status(200).send({ 
                total,
                pages: Math.ceil(total/itemsPerPage),
                page: page,
                publications
            });
        });
  
}

function deletePublication(req, res){
    var publicationId = req.params.id;
    var user_auth = req.user.sub;

    //buscar la publicacion correspondiente al user autenticado
    Publications.findOne({'user': user_auth, '_id': publicationId}).exec((err, result)=>{
        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
        if(!result) return res.status(404).send({ message: 'No se ha podido eliminar publicacion'});

        //se busca la imagen anterior, si existe, se borra y se actualiza la imagen
            var before_image = beforeImage(publicationId)
            .then((value)=>{
                if(value.file == null){
                    result.remove((err)=>{
                        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
                        return res.status(200).send({ message: 'Se ha eliminado la publicacion correctamente'});
                    });
                }else{
                    fs.unlink('uploads/publications/'+value.file, (err)=>{
                        if (err) return res.status(500).send({ message: 'Error interno del servidor' + err});
                        console.log('File deleted!');  
                    });
                    result.remove((err)=>{
                        if(err) return res.status(500).send({ message: 'Error interno del servidor'});
                        return res.status(200).send({ message: 'Se ha eliminado la publicacion correctamente'});
                    });
                }  
            }); // before delete image
    });

}


//subir imagen de publicacion 
function uploadFilePublication(req, res){
    var PublicationId = req.params.id;
    if(req.files){
        //si existe el archivo buscamos por la prop. image (parametro)
        var file_path = req.files.image.path; // [path\dir\nameimage.jpg]
            var file_split = file_path.split('\\'); // [path, dir, nameimage.jpg]
        var file_name = file_split[2]; //nameimage.jpg
        var file_ext = file_name.split('.')[1]; //?.jpg?.png..

        if(file_ext == 'png' || file_ext == 'jpg' || file_ext == 'jpeg' || file_ext == 'gif'){
            //publicacion correspondiente al usuario aut.
            Publications.findOne({'user': req.user.sub, '_id': PublicationId}).exec((err, result)=>{
                if(err) return res.status(500).send({ message: 'Error en la peticion' });
                    if(result){
                            //actualizar en db la propiedad: file 
                            Publications.findByIdAndUpdate(PublicationId, {file: file_name}, {new:true}, (err, updatePublication)=>{
                                if(err) return res.status(500).send({ message: 'Error en la peticion' });
                                if(!updatePublication) return res.status(404).send({ message: 'No se pudo actualizar la publicacion'});

                                    return res.status(200).send({ publication: updatePublication });
                            });

                    }else{
                        removeProfileUploads(res, file_path, 'No tienes permisos para realizar esta accion');
                    }
            });
        }else{
            removeProfileUploads(res, file_path, 'extension de archivo invalido');
        } 
    }else{
        removeProfileUploads(res, file_path, 'Error interno del servidor');
    }

      
}
        //function para obtener la imagen anterior
        async function beforeImage(pubId){
            var path = await Publications.findOne({'_id': pubId}, 'file', (err, file)=>{
                if(err) return handleError(err);
                return file;
            });
            return path;
        }

        //funcion para eliminar la imagen del sistema
        function removeProfileUploads(res, file_path, message){
            fs.unlink(file_path, (err)=>{
                if(err) return res.status(500).send({message: message +err});
                return res.status(200).send({ message });
            });
        }

//obtener imagen de publicacion por su url
function getImagePublication(req, res){
    var image_file = req.params.imageFile;
    var image_path = './uploads/publications/'+image_file;

    fs.exists(image_path, (exists)=>{
        if(exists){
            res.sendFile(path.resolve(image_path));
        }
        else{
            res.status(404).send({ message: 'No existe la imagen indicada'});
        }
    });
}

function countPublications(req, res){
    pubId = req.params.id;
   
    Publications.count({'user': req.user.sub, '_id': pubId}).exec((err, countPub)=>{
        if(err) return res.status(500).send({ message: 'Error interno del servidor' });
        return res.status(200).send({ count_publications: countPub });
    });
}




module.exports = {
    test,
    savePublication,
    getPublicationsTimeline,
    getPublication,
    getPublicationUser,
    deletePublication,
    uploadFilePublication,
    getImagePublication
}